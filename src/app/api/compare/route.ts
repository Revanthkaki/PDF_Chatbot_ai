import { z } from "zod";
import { store } from "@/lib/store";
import { compareContracts } from "@/lib/compare";
import { failure, sameOrigin } from "@/lib/http";
export async function POST(request: Request) {
  try { sameOrigin(request); const input = z.object({ originalId: z.string().uuid(), revisedId: z.string().uuid() }).parse(await request.json()); if (input.originalId === input.revisedId) throw new Error("Select two different documents."); const original = store().get(input.originalId); const revised = store().get(input.revisedId); if (!original || !revised || original.status !== "ready" || revised.status !== "ready") throw new Error("Select two fully indexed documents."); return Response.json(compareContracts(original, revised)); }
  catch (error) { return failure(error); }
}