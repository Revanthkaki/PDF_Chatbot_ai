"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUp, Check, CheckCheck, ChevronDown, CircleAlert, FilePlus2, FileSearch, FileText, FolderOpen, LoaderCircle, Menu, MessageSquare, Scale, Search, ShieldCheck, Square, Trash2, Upload, X } from "lucide-react";
import type { Citation, Contract, Coverage, Message, Occurrence } from "@/lib/types";
import type { Change } from "@/lib/compare";
import DocumentViewer from "./document-viewer";

type LibraryDocument = Pick<Contract, "id" | "name" | "kind" | "status" | "error" | "created" | "pages" | "characters"> & { progress: number };
type CompareResult = { changes: Change[]; complete: boolean; originalClauses: number; revisedClauses: number; examinedOriginal: number; examinedRevised: number; method: string };
async function jsonFetch(url: string, options?: RequestInit) { const response = await fetch(url, options); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Request failed."); return result; }
function EvidenceCard({ citation, onOpen }: { citation: Citation; onOpen: (citation: Citation, occurrence: Occurrence) => void }) {
  const [index, setIndex] = useState(0);
  return <div className="evidence-card"><div className="evidence-heading"><span className="verified"><ShieldCheck size={13} /> Verified · {citation.id}</span><span>Section {citation.occurrences[index].segments.map(segment => segment.number).join("–")}</span></div><button className="quote-button" onClick={() => onOpen(citation, citation.occurrences[index])}><blockquote>“{citation.quote}”</blockquote><span className="citation-source"><FileText size={12} /> {citation.documentName}</span></button>{citation.occurrences.length > 1 && <label className="occurrence-select">Occurrence<select aria-label="Quote occurrence" value={index} onChange={event => { const next = Number(event.target.value); setIndex(next); onOpen(citation, citation.occurrences[next]); }}>{citation.occurrences.map((occurrence, number) => <option key={number} value={number}>{number + 1} of {citation.occurrences.length} · section {occurrence.segments[0]?.number}</option>)}</select></label>}</div>;
}
function AnswerText({ content, citations, onOpen }: { content: string; citations: Citation[]; onOpen: (citation: Citation, occurrence: Occurrence) => void }) { return <div className="answer-text">{content.split(/(\[\[C\d+\]\])/g).map((part, index) => { const id = part.match(/^\[\[(C\d+)\]\]$/)?.[1]; if (!id) return <span key={index}>{part}</span>; const citation = citations.find(citation => citation.id === id); return citation ? <button className="citation-chip" key={index} title={`Open verified quote in ${citation.documentName}`} onClick={() => onOpen(citation, citation.occurrences[0])}><Check size={10} />{id}</button> : <span className="pending-citation" key={index}>{id} · unverified</span>; })}</div>; }
function CoverageSummary({ coverage }: { coverage: Coverage[] }) { return <details className="coverage-summary"><summary><Search size={11} />Bounded evidence search</summary>{coverage.map(item => <div key={item.documentId}><span>{item.name}</span><span>{item.retrievedChunks}/{item.totalChunks} chunks retrieved{!item.indexed ? " · indexing incomplete" : item.fullyExamined ? " · all chunks retrieved" : " · not a full-document review"}</span></div>)}</details>; }

export default function Workspace() {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState("AI provider");
  const [model, setModel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");
  const [active, setActive] = useState<Contract>();
  const [target, setTarget] = useState<{ occurrence: Occurrence; quote: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"analysis" | "compare">("analysis");
  const [mobileLibrary, setMobileLibrary] = useState(false);
  const [originalId, setOriginalId] = useState("");
  const [revisedId, setRevisedId] = useState("");
  const [comparison, setComparison] = useState<CompareResult>();
  const [compareBusy, setCompareBusy] = useState(false);
  const [significance, setSignificance] = useState("All");
  const [sort, setSort] = useState("significance");
  const input = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController>(null);
  const selection = [...selected].sort().join(",");
  async function refresh() { try { const result = await jsonFetch("/api/documents"); setDocuments(result.documents); setConfigured(result.configured); setModel(result.model); setProvider(result.provider || "Gemini"); } catch (error) { setError(error instanceof Error ? error.message : "Library unavailable."); } }
  useEffect(() => {
    let alive = true;
    const load = () => jsonFetch("/api/documents").then(result => { if (alive) { setDocuments(result.documents); setConfigured(result.configured); setModel(result.model); setProvider(result.provider || "Gemini"); } }).catch(error => { if (alive) setError(error.message); });
    void load(); const interval = setInterval(() => void load(), 1800);
    return () => { alive = false; clearInterval(interval); };
  }, []);
  useEffect(() => { let alive = true; void (activeId ? jsonFetch(`/api/documents/${activeId}`) : Promise.resolve(undefined)).then(document => { if (alive) setActive(document); }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [activeId]);
  useEffect(() => { let alive = true; if (busy) return; void (selection ? jsonFetch(`/api/history?ids=${selection}`) : Promise.resolve({ messages: [] })).then(result => { if (alive) setMessages(result.messages); }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [selection, busy]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: busy ? "instant" : "smooth", block: "end" }); }, [messages, busy]);
  const ready = documents.filter(document => document.status === "ready");
  const openDocument = (id: string) => { setActiveId(id); setTarget(undefined); setMobileLibrary(false); if (!selected.includes(id)) setSelected([id]); };
  async function upload(files: FileList | File[]) {
    setUploading(true); setError("");
    for (const file of Array.from(files)) {
      try { const form = new FormData(); form.append("file", file); const result = await jsonFetch("/api/documents", { method: "POST", body: form }); if (result.duplicate) setError(`${file.name} is already in the library.`); }
      catch (error) { setError(error instanceof Error ? error.message : "Upload failed."); }
    }
    await refresh(); setUploading(false); if (input.current) input.current.value = "";
  }
  async function remove(document: LibraryDocument) {
    if (!window.confirm(`Delete ${document.name} and its associated chat history?`)) return;
    try { await jsonFetch(`/api/documents/${document.id}`, { method: "DELETE" }); setSelected(ids => ids.filter(id => id !== document.id)); if (activeId === document.id) { setActiveId(""); setActive(undefined); } setComparison(undefined); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Delete failed."); }
  }
  function openCitation(citation: Citation, occurrence: Occurrence) { setActiveId(citation.documentId); setTarget({ occurrence, quote: citation.quote }); setTab("analysis"); }
  async function ask(event: React.FormEvent) {
    event.preventDefault(); if (!question.trim() || !selected.length || busy) return;
    const asked = question.trim(); setQuestion(""); setBusy(true); setError("");
    const assistantId = crypto.randomUUID();
    const base = { citations: [], activity: [], coverage: [], created: new Date().toISOString() };
    setMessages(history => [...history, { ...base, id: crypto.randomUUID(), role: "user", content: asked, status: "complete" }, { ...base, id: assistantId, role: "assistant", content: "", status: "streaming" }]);
    const abort = new AbortController(); controller.current = abort;
    const update = (patch: Partial<Message>) => setMessages(history => history.map(message => message.id === assistantId ? { ...message, ...patch } : message));
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: asked, documentIds: selected, research }), signal: abort.signal });
      if (!response.ok) throw new Error((await response.json()).error);
      if (!response.body) throw new Error("Streaming response is unavailable.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let content = ""; const activity: string[] = [];
      while (true) {
        const result = await reader.read(); buffer += decoder.decode(result.value, { stream: !result.done }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue; const event = JSON.parse(line);
          if (event.type === "token") { content += event.text; update({ content }); }
          if (event.type === "activity") { activity.push(event.text); update({ activity: [...activity] }); }
          if (event.type === "coverage") update({ coverage: event.coverage });
          if (event.type === "done") update({ content: event.content, citations: event.citations, status: event.status });
          if (event.type === "error") setError(event.error);
        }
        if (result.done) break;
      }
    } catch (error) { if (abort.signal.aborted) update({ status: "cancelled" }); else { setError(error instanceof Error ? error.message : "Chat failed."); update({ status: "error" }); } }
    finally { controller.current = null; setBusy(false); }
  }
  async function compare() { setCompareBusy(true); setError(""); try { setComparison(await jsonFetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalId, revisedId }) })); } catch (error) { setError(error instanceof Error ? error.message : "Comparison failed."); } finally { setCompareBusy(false); } }
  const displayedChanges = comparison?.changes.filter(change => significance === "All" || change.significance === significance).sort((left, right) => sort === "significance" ? ["High", "Medium", "Low"].indexOf(left.significance) - ["High", "Medium", "Low"].indexOf(right.significance) : Number(left.id.split("-")[1]) - Number(right.id.split("-")[1])) || [];
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-symbol"><Scale size={23} strokeWidth={1.5} /></div><span>Accord<span className="brand-dot">.</span></span><span className="brand-caption">CONTRACT WORKSPACE</span></div><div className="topbar-right"><span className="local-badge"><span />Local workspace</span><button className="icon-button mobile-toggle" title="Toggle document library" onClick={() => setMobileLibrary(value => !value)}><Menu size={20} /></button></div></header>
    <div className="app-body"><aside className={`sidebar ${mobileLibrary ? "mobile-open" : ""}`}>
      <div className="sidebar-heading"><h2>Documents <span className="count">{documents.length}</span></h2><button className="icon-button" title="Upload contract" disabled={uploading} onClick={() => input.current?.click()}><FilePlus2 size={18} /></button></div>
      <input ref={input} type="file" accept=".pdf,.docx" multiple hidden onChange={event => { if (event.target.files) void upload(event.target.files); }} aria-label="Upload PDF or DOCX" />
      <button className={`dropzone ${dragging ? "dragging" : ""}`} disabled={uploading} onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!uploading) void upload(event.dataTransfer.files); }}><div className="upload-icon">{uploading ? <LoaderCircle size={22} className="spin" /> : <Upload size={22} />}</div><strong>{uploading ? "Uploading files…" : "Upload contracts"}</strong><span>PDF or DOCX · up to 30 MB</span></button>
      <label className="library-search"><Search size={15} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a document" aria-label="Find a document" /></label>
      <div className="library-list">{documents.filter(document => document.name.toLowerCase().includes(filter.toLowerCase())).map(document => <div className={`library-item ${activeId === document.id ? "active" : ""}`} key={document.id}><input type="checkbox" aria-label={`Select ${document.name}`} disabled={document.status !== "ready" || busy} checked={selected.includes(document.id)} onChange={event => { setSelected(ids => event.target.checked ? [...ids, document.id].slice(0, 6) : ids.filter(id => id !== document.id)); if (!activeId) setActiveId(document.id); }} /><button className="document-button" disabled={document.status !== "ready" || busy} onClick={() => openDocument(document.id)}><span className={`file-type ${document.kind}`}>{document.kind.toUpperCase()}</span><span className="document-label"><strong>{document.name}</strong><span className={`document-status ${document.status}`}>{document.status === "ready" ? <><CheckCheck size={11} /> {document.pages} {document.kind === "pdf" ? "pages" : "paragraphs"} · Indexed</> : document.status === "processing" ? <><LoaderCircle size={11} className="spin" />{document.progress ? `Extracting · ${document.progress}%` : "Queued for indexing"}</> : <><CircleAlert size={11} />Processing failed</>}</span>{document.error && <span className="document-error">{document.error}</span>}</span></button><button className="icon-button delete-document" title={`Delete ${document.name}`} disabled={busy} onClick={() => void remove(document)}><Trash2 size={14} /></button></div>)}{!documents.length && <div className="library-empty"><FolderOpen size={24} /><span>Your document library is empty.</span></div>}</div>
      <div className="sidebar-footer"><ShieldCheck size={17} /><div><strong>Private by default</strong><span>Files stored on this machine.<br />Retrieved passages sent to {provider}.</span></div></div>
    </aside><div className="main-workspace">
      <div className="workspace-header"><div className="workspace-title"><span className="eyebrow">WORKSPACE</span><h1>{tab === "compare" ? "Version comparison" : active?.name.replace(/\.(pdf|docx)$/i, "") || "Contract analysis"}</h1></div><nav className="view-tabs" aria-label="Workspace view"><button className={tab === "analysis" ? "selected" : ""} onClick={() => setTab("analysis")}><MessageSquare size={15} />Analysis</button><button className={tab === "compare" ? "selected" : ""} disabled={busy} onClick={() => setTab("compare")}><ArrowLeftRight size={15} />Compare</button></nav></div>
      {error && <div role="alert" className="notice danger"><CircleAlert size={16} /><span>{error}</span><button className="icon-button" title="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
      {tab === "analysis" ? <div className="analysis-layout"><div className="document-panel">{active?.status === "ready" ? <DocumentViewer key={active.id} document={active} target={target} /> : <div className="document-empty"><div className="empty-paper"><FileText size={48} strokeWidth={1} /></div><h2>No document open</h2><p>{ready.length ? "Select a contract from your library." : "Add a contract to begin."}</p><button className="primary-button" onClick={() => input.current?.click()} disabled={uploading}><Upload size={16} />Upload contract</button><span className="empty-formats">PDF · DOCX</span></div>}</div>
        <section className="chat-panel" aria-label="Contract chat"><div className="chat-heading"><div><div className="panel-heading"><span className="accent-square" />Evidence-backed analysis</div><span className="panel-subtitle">{selected.length ? `${selected.length} ${selected.length === 1 ? "document" : "documents"} selected` : "No documents selected"}</span></div><ShieldCheck size={19} className="accent-icon" /></div>
          {selected.length > 0 && <div className="selected-documents">{selected.map(id => <span key={id}><FileText size={11} />{documents.find(document => document.id === id)?.name}<button title="Remove document from question" disabled={busy} onClick={() => setSelected(ids => ids.filter(item => item !== id))}><X size={11} /></button></span>)}</div>}
          <div className="chat-scroll">{!messages.length && <div className="chat-empty"><FileSearch size={33} strokeWidth={1.2} /><h2>What needs a closer look?</h2><p>{configured ? "Ask about the selected contracts." : `${provider} API key not configured.`}</p>{configured && <div className="suggested-questions">{["What is the liability cap?", "How can this contract be terminated?", "Compare payment obligations across selected contracts."].map(text => <button key={text} disabled={!selected.length} onClick={() => setQuestion(text)}>{text}<ArrowUp size={13} /></button>)}</div>}{!configured && <div className="configuration-note">Set <code>{provider === "Groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"}</code> in <code>.env.local</code> and restart.</div>}</div>}
            {messages.map(message => <article className={`chat-message ${message.role}`} key={message.id}><div className="message-label">{message.role === "user" ? "YOU" : <><Scale size={13} /> ACCORD</>}{message.role === "assistant" && <span className={`message-status ${message.status}`}>{message.status === "streaming" ? "Draft · verification pending" : message.status === "complete" ? "Evidence checked" : `${message.status} · unverified partial`}</span>}</div>{message.activity.length > 0 && <details className="research-activity" open={message.status === "streaming"}><summary><FileSearch size={12} />{message.status === "streaming" ? message.activity.at(-1) : `Research activity · ${message.activity.length} events`}<ChevronDown size={12} /></summary><ol>{message.activity.map((text, index) => <li key={index}>{text}</li>)}</ol></details>}<AnswerText content={message.content} citations={message.citations} onOpen={openCitation} />{message.status === "streaming" && !message.content && <div className="thinking"><LoaderCircle className="spin" size={14} />Retrieving evidence…</div>}{message.citations.map(citation => <EvidenceCard key={citation.id} citation={citation} onOpen={openCitation} />)}{message.coverage.length > 0 && <CoverageSummary coverage={message.coverage} />}</article>)}<div ref={chatEnd} />
          </div><form className="composer" onSubmit={ask}><div className="composer-input"><textarea aria-label="Ask about selected contracts" placeholder="Ask about your contracts…" value={question} onChange={event => setQuestion(event.target.value)} disabled={busy} rows={3} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div className="composer-controls"><label className={`research-toggle ${research ? "enabled" : ""}`}><input type="checkbox" checked={research} disabled={busy} onChange={event => setResearch(event.target.checked)} /><FileSearch size={14} />Research</label>{busy ? <button className="stop-button" type="button" title="Stop generation" onClick={() => controller.current?.abort()}><Square size={13} fill="currentColor" />Stop</button> : <button className="send-button" title="Send question" type="submit" disabled={!question.trim() || !selected.length || !configured}><ArrowUp size={18} /></button>}</div></div><div className="composer-footer"><span><ShieldCheck size={11} />Exact quotes checked against source</span><span title={model}>{provider}</span></div></form>
        </section></div> : <section className="comparison-workspace">
        <div className="comparison-controls"><label>Original contract<select aria-label="Original contract" value={originalId} disabled={compareBusy} onChange={event => { setOriginalId(event.target.value); setComparison(undefined); }}><option value="">Select original…</option>{ready.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label><ArrowLeftRight size={21} /><label>Revised contract<select aria-label="Revised contract" value={revisedId} disabled={compareBusy} onChange={event => { setRevisedId(event.target.value); setComparison(undefined); }}><option value="">Select revised…</option>{ready.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label><button className="primary-button" disabled={!originalId || !revisedId || originalId === revisedId || compareBusy} onClick={() => void compare()}>{compareBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowLeftRight size={16} />}Compare versions</button></div>
        {comparison ? <><div className="comparison-summary"><div><span className="eyebrow">REVIEW SUMMARY</span><h2>{comparison.changes.length} changes detected</h2><p>{comparison.examinedOriginal} original and {comparison.examinedRevised} revised paragraphs aligned.</p></div><div className="significance-counts">{["High", "Medium", "Low"].map(level => <button key={level} className={`significance-stat ${level.toLowerCase()}`} onClick={() => setSignificance(level)}><strong>{comparison.changes.filter(change => change.significance === level).length}</strong><span>{level} significance</span></button>)}</div></div>{!comparison.complete && <div className="notice warning">Comparison is incomplete: {comparison.examinedOriginal} of {comparison.originalClauses} original and {comparison.examinedRevised} of {comparison.revisedClauses} revised paragraphs were aligned.</div>}<div className="change-toolbar"><div className="filter-tabs" aria-label="Significance filter">{["All", "High", "Medium", "Low"].map(level => <button key={level} className={significance === level ? "selected" : ""} onClick={() => setSignificance(level)}>{level}</button>)}</div><select aria-label="Sort changes" value={sort} onChange={event => setSort(event.target.value)}><option value="significance">Significance first</option><option value="source">Source order</option></select></div><div className="comparison-column-headings"><span>ORIGINAL</span><span>REVISED</span></div><div className="changes-list">{displayedChanges.map(change => <article className="change" key={change.id}><div className="change-heading"><span className={`significance-badge ${change.significance.toLowerCase()}`}>{change.significance}</span><strong>{change.topic}</strong><span className="change-type">{change.type}</span></div><p className="change-explanation">{change.explanation}</p><div className="change-sources"><button className={`change-source original ${!change.original ? "empty-source" : ""}`} disabled={!change.originalOccurrences.length} onClick={() => openCitation({ id: change.id, documentId: originalId, documentName: "Original", quote: change.original.slice(0, 3500), occurrences: change.originalOccurrences }, change.originalOccurrences[0])}>{change.original || "No provision in original"}{change.original && <span>Open original passage</span>}</button><button className={`change-source revised ${!change.revised ? "empty-source" : ""}`} disabled={!change.revisedOccurrences.length} onClick={() => openCitation({ id: change.id, documentId: revisedId, documentName: "Revised", quote: change.revised.slice(0, 3500), occurrences: change.revisedOccurrences }, change.revisedOccurrences[0])}>{change.revised || "Removed from revised"}{change.revised && <span>Open revised passage</span>}</button></div></article>)}{!displayedChanges.length && <div className="comparison-empty"><CheckCheck size={32} /><h2>{comparison.changes.length ? "No changes match this filter" : "No changes detected in examined paragraphs"}</h2></div>}</div><div className="comparison-method">{comparison.method}</div></> : <div className="comparison-empty"><ArrowLeftRight size={36} strokeWidth={1.2} /><h2>Two versions. One clear review.</h2><p>Select an original and revised contract.</p></div>}
      </section>}
    </div></div>
  </main>;
}