import mammoth from "mammoth";
import type { Segment } from "./types";

export function validateUpload(name: string, bytes: Uint8Array, maxBytes = 30 * 1024 * 1024): "pdf" | "docx" {
  if (!bytes.length || bytes.length > maxBytes) throw new Error(`File must be nonempty and smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "pdf";
  if (extension === "docx" && bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx";
  throw new Error("Only genuine PDF and DOCX files are accepted. File contents must match the extension.");
}
export function joinSegments(parts: string[], kind: "pdf" | "docx") {
  let text = "";
  const segments: Segment[] = parts.map((part, index) => {
    const start = text.length;
    text += part;
    const segment = { id: `${kind === "pdf" ? "page" : "paragraph"}-${index + 1}`, number: index + 1, text: part, start, end: text.length };
    text += "\n\n";
    return segment;
  });
  return { text, segments };
}
export async function extract(bytes: Uint8Array, kind: "pdf" | "docx", progress: (value: number) => void = () => {}) {
  const parts: string[] = [];
  if (kind === "docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    parts.push(...result.value.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean));
    progress(90);
  } else {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const document = await task.promise;
    try {
      if (document.numPages > 1500) throw new Error("The maximum supported document size is 1,500 pages.");
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        parts.push(content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
        page.cleanup();
        progress(Math.round(number / document.numPages * 90));
      }
    } finally { await task.destroy(); }
  }
  const result = joinSegments(parts, kind);
  if (result.text.trim().length < 20) throw new Error("No usable text found. This file may be scanned, empty, or unreadable. Upload a text-based PDF or a DOCX; OCR is not installed.");
  if (result.text.length > 12_000_000) throw new Error("Extracted text exceeds the 12 million character limit.");
  return result;
}