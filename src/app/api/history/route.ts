import { idsSchema, failure } from "@/lib/http";
import { store } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const ids = idsSchema.parse(new URL(request.url).searchParams.get("ids")?.split(",")); return Response.json({ messages: store().history(ids) }); }
  catch (error) { return failure(error); }
}