"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Contract, Occurrence } from "@/lib/types";
import { normalizeWithMap } from "@/lib/verification";

export type CitationTarget = { occurrence: Occurrence; quote: string };
function PdfPage({ pdf, number, width, fragment, onMismatch }: { pdf: PDFDocumentProxy; number: number; width: number; fragment?: { text: string; normalizedStart: number; normalizedSource: string }; onMismatch: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const highlightLayer = useRef<HTMLDivElement>(null);
  const renderedSpans = useRef<HTMLElement[]>([]);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(0);
  const [aspect, setAspect] = useState(0.707);
  const [error, setError] = useState("");
  const targeted = Boolean(fragment);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { setVisible(entries[0].isIntersecting); }, { rootMargin: "400px" });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!canvas.current || !textLayer.current) return;
    if (!visible && !targeted) {
      canvas.current.width = 0; canvas.current.height = 0;
      textLayer.current.replaceChildren(); highlightLayer.current?.replaceChildren();
      renderedSpans.current = [];
      return;
    }
    let alive = true;
    let cancel = () => {};
    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await pdf.getPage(number);
        const natural = page.getViewport({ scale: 1 });
        const scale = width / natural.width;
        const viewport = page.getViewport({ scale });
        if (!alive || !canvas.current || !textLayer.current) return;
        const surface = canvas.current;
        const density = Math.min(window.devicePixelRatio || 1, 2);
        surface.width = viewport.width * density; surface.height = viewport.height * density;
        surface.style.width = `${viewport.width}px`; surface.style.height = `${viewport.height}px`;
        setAspect(natural.width / natural.height);
        const layer = textLayer.current;
        layer.replaceChildren();
        layer.style.setProperty("--scale-factor", String(scale));
        layer.style.setProperty("--total-scale-factor", String(scale));
        const content = await page.getTextContent();
        if (!alive) return;
        const renderTask = page.render({ canvas: surface, viewport, transform: [density, 0, 0, density, 0, 0] });
        const textTask = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
        cancel = () => { renderTask.cancel(); textTask.cancel(); };
        await Promise.all([renderTask.promise, textTask.render()]);
        if (alive) { renderedSpans.current = textTask.textDivs; setRendered(value => value + 1); setError(""); }
      } catch (error) { if (alive && !(error instanceof Error && error.name === "RenderingCancelledException")) setError("This PDF page could not be rendered."); }
    }
    void render();
    return () => { alive = false; cancel(); };
  }, [pdf, number, width, visible, targeted]);
  useEffect(() => {
    const layer = textLayer.current; const highlights = highlightLayer.current;
    if (!layer || !highlights || !container.current) return;
    highlights.replaceChildren();
    if (!fragment || !rendered) return;
    const spans = renderedSpans.current.filter(span => span.textContent);
    let source = "";
    const offsets = spans.map(span => { const start = source.length; source += span.textContent + " "; return { span, start, end: source.length - 1 }; });
    const normalized = normalizeWithMap(source);
    const quote = normalizeWithMap(fragment.text).text;
    const position = fragment.normalizedStart;
    const best = quote && normalized.text === fragment.normalizedSource && normalized.text.slice(position, position + quote.length) === quote ? { start: normalized.starts[position], end: normalized.ends[position + quote.length - 1] } : undefined;
    if (!best) { onMismatch("The quote is verified in extracted text, but this PDF text layer could not map it reliably. No potentially wrong highlight was drawn."); return; }
    const origin = container.current.getBoundingClientRect();
    for (const item of offsets) {
      if (item.end <= best.start || item.start >= best.end || !item.span.firstChild) continue;
      const range = document.createRange();
      range.setStart(item.span.firstChild, Math.max(0, best.start - item.start));
      range.setEnd(item.span.firstChild, Math.min(item.span.textContent?.length || 0, best.end - item.start));
      for (const rectangle of Array.from(range.getClientRects())) {
        const mark = document.createElement("div"); mark.className = "pdf-highlight";
        Object.assign(mark.style, { left: `${rectangle.left - origin.left}px`, top: `${rectangle.top - origin.top}px`, width: `${rectangle.width}px`, height: `${rectangle.height}px` });
        highlights.appendChild(mark);
      }
    }
  }, [fragment, rendered, onMismatch]);
  return <div className="pdf-page" ref={container} data-source-id={`page-${number}`} style={{ width, aspectRatio: aspect }}><canvas ref={canvas} /><div className="textLayer" ref={textLayer} /><div className="highlight-layer" ref={highlightLayer} />{!rendered && <div className="page-loading"><LoaderCircle className="spin" size={18} /> Page {number}</div>}{error && <div className="page-error">{error}</div>}<span className="page-number">{number}</span></div>;
}

export default function DocumentViewer({ document: contract, target }: { document: Contract; target?: CitationTarget }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState("");
  const [mappingError, setMappingError] = useState("");
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contract.kind !== "pdf") return;
    let alive = true; let destroy = () => {};
    async function load() {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!alive) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
        const task = pdfjs.getDocument({ url: `/api/documents/${contract.id}/file`, useSystemFonts: true });
        destroy = () => { void task.destroy(); };
        const document = await task.promise;
        if (alive) setPdf(document);
      } catch { if (alive) setError("Unable to load this PDF. Download the original or read the extracted source below."); }
    }
    void load();
    return () => { alive = false; destroy(); };
  }, [contract.id, contract.kind]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width - 48)));
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const number = target?.occurrence.segments[0]?.number;
    if (!number) return;
    const timer = setTimeout(() => { setPage(number); setMappingError(""); scroller.current?.querySelector(`[data-source-id="${contract.kind === "pdf" ? "page" : "paragraph"}-${number}"]`)?.scrollIntoView({ behavior: "instant", block: "center" }); }, 100);
    return () => clearTimeout(timer);
  }, [target, contract.kind, pdf, width, zoom]);
  const goto = (number: number) => { const bounded = Math.max(1, Math.min(contract.pages, number)); setPage(bounded); scroller.current?.querySelector(`[data-source-id="${contract.kind === "pdf" ? "page" : "paragraph"}-${bounded}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return <section className="viewer" aria-label="Document viewer"><div className="viewer-toolbar"><div className="source-label"><FileText size={15} /><span>{contract.kind.toUpperCase()} · {contract.pages} {contract.kind === "pdf" ? "pages" : "paragraphs"}</span></div><div className="tool-group"><button className="icon-button" title="Previous source section" onClick={() => goto(page - 1)} disabled={page <= 1}><ChevronLeft size={16} /></button><input className="page-input" aria-label="Source section number" type="number" min={1} max={contract.pages} value={page} onChange={event => goto(Number(event.target.value))} /><button className="icon-button" title="Next source section" onClick={() => goto(page + 1)} disabled={page >= contract.pages}><ChevronRight size={16} /></button>{contract.kind === "pdf" && <><button className="icon-button" title="Zoom out" onClick={() => setZoom(value => Math.max(0.6, value - 0.1))}><ZoomOut size={16} /></button><button className="icon-button" title="Zoom in" onClick={() => setZoom(value => Math.min(1.8, value + 0.1))}><ZoomIn size={16} /></button></>}<a className="icon-button" title="Download original document" href={`/api/documents/${contract.id}/file`} download={contract.name}><Download size={16} /></a></div></div>{mappingError && <div className="notice warning">{mappingError}<blockquote>{target?.quote}</blockquote></div>}<div className="document-scroll" ref={scroller}>{error && <div className="notice danger">{error}</div>}{contract.kind === "pdf" && pdf && !error ? Array.from({ length: contract.pages }, (_, index) => { const selected = target?.occurrence.segments.find(segment => segment.number === index + 1); const segment = contract.segments[index]; const normalized = selected ? normalizeWithMap(segment.text) : undefined; const fragment = selected && normalized ? { text: segment.text.slice(selected.start, selected.end), normalizedStart: normalized.starts.findIndex(start => start >= selected.start), normalizedSource: normalized.text } : undefined; return <PdfPage key={index} pdf={pdf} number={index + 1} width={Math.min(width, 900) * zoom} fragment={fragment} onMismatch={setMappingError} />; }) : contract.kind === "pdf" && !error ? <div className="loading"><LoaderCircle className="spin" size={22} /> Loading PDF</div> : <article className="docx-document"><h2>{contract.name.replace(/\.(pdf|docx)$/i, "")}</h2>{contract.segments.map(segment => { const occurrence = target?.occurrence.segments.find(item => item.id === segment.id); return <p key={segment.id} data-source-id={segment.id} className={occurrence ? "active-paragraph" : ""}><span className="paragraph-number">{segment.number}</span>{occurrence ? <>{segment.text.slice(0, occurrence.start)}<mark data-testid="docx-highlight">{segment.text.slice(occurrence.start, occurrence.end)}</mark>{segment.text.slice(occurrence.end)}</> : segment.text}</p>; })}</article>}</div></section>;
}