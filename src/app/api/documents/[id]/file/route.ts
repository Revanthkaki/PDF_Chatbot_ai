import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, store } from "@/lib/store";
import { failure } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const document = store().get((await context.params).id);
  if (!document) return failure(new Error("Document not found."), 404);
  try { const bytes = await readFile(path.join(dataDirectory(), "files", document.id)); return new Response(bytes, { headers: { "Content-Type": document.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.name)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return failure(new Error("Original file is unavailable."), 404); }
}