import { createHash, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, store } from "@/lib/store";
import { validateUpload } from "@/lib/extract";
import { failure, sameOrigin } from "@/lib/http";
import { aiConfigured, modelName, providerName } from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ documents: store().list(), configured: aiConfigured(), model: modelName(), provider: providerName() }); }
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const maxBytes = Math.min(Number(process.env.MAX_UPLOAD_MB) || 30, 100) * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > maxBytes + 1024 * 1024) throw new Error("Upload exceeds the configured size limit.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("A PDF or DOCX file is required.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = validateUpload(file.name, bytes, maxBytes);
    const database = store();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = database.byHash(hash);
    if (existing) return Response.json({ id: existing.id, duplicate: true });
    const id = randomUUID();
    await writeFile(path.join(dataDirectory(), "files", id), bytes, { flag: "wx" });
    try { database.add(id, hash, path.basename(file.name).slice(0, 200), kind); }
    catch (error) { await unlink(path.join(dataDirectory(), "files", id)); const raced = database.byHash(hash); if (raced) return Response.json({ id: raced.id, duplicate: true }); throw error; }
    return Response.json({ id }, { status: 202 });
  } catch (error) { return failure(error); }
}