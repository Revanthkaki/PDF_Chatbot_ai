import { z } from "zod";
import { idsSchema, failure, sameOrigin } from "@/lib/http";
import { store } from "@/lib/store";
import { answer, aiClient } from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = z.object({ question: z.string().trim().min(1).max(4000), documentIds: idsSchema, research: z.boolean().default(false) }).parse(await request.json());
    const database = store();
    if (input.documentIds.some(id => database.get(id)?.status !== "ready")) throw new Error("All selected documents must be fully indexed before chat.");
    aiClient();
    database.message(input.documentIds, "user", input.question);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 240_000);
    const stream = new ReadableStream({
      start(output) {
        const encode = new TextEncoder();
        const emit = (event: unknown) => { try { output.enqueue(encode.encode(JSON.stringify(event) + "\n")); } catch { controller.abort(); } };
        void answer(input.question, input.documentIds, input.research, database, controller.signal, emit).finally(() => { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); try { output.close(); } catch {} });
      },
      cancel() { controller.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) { return failure(error); }
}