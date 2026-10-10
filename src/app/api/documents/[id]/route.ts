import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataDirectory, store } from "@/lib/store";
import { failure, sameOrigin } from "@/lib/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const document = store().get(id);
  return document ? Response.json(document) : failure(new Error("Document not found."), 404);
}
export async function DELETE(request: Request, context: Context) {
  try { sameOrigin(request); const id = z.string().uuid().parse((await context.params).id); store().delete(id); await unlink(path.join(dataDirectory(), "files", id)).catch(() => {}); return Response.json({ deleted: true }); }
  catch (error) { return failure(error); }
}