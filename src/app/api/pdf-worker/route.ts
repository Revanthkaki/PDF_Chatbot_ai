import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function GET() {
  return new Response(await readFile(path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs")), { headers: { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=86400" } });
}