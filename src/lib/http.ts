import { z } from "zod";
export const idsSchema = z.array(z.string().uuid()).min(1).max(6).transform(ids => [...new Set(ids)]);
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Cross-origin writes are not allowed.");
}
export function failure(error: unknown, status = 400) { return Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status }); }