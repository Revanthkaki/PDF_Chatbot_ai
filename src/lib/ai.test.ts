import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "./store";
import { joinSegments } from "./extract";
import { answer, gemini, type ChatEvent } from "./ai";

const fake = vi.hoisted(() => ({ stream: vi.fn(), complete: vi.fn(), configure: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { constructor(options: unknown) { fake.configure(options); } models = { generateContentStream: fake.stream, generateContent: fake.complete }; }, FunctionCallingConfigMode: { AUTO: "AUTO" } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function fixture(run: (database: Store) => Promise<void>) {
  const directory = mkdtempSync(path.join(tmpdir(), "ai-tests-")); const database = new Store(directory);
  try { vi.stubEnv("GEMINI_API_KEY", "isolated-test-provider"); database.add("a", "a", "A.pdf", "pdf"); const result = joinSegments(["The parties shall", "keep information confidential."], "pdf"); database.finish("a", result.segments, result.text); await run(database); }
  finally { database.db.close(); rmSync(directory, { recursive: true, force: true }); }
}
describe("streaming answer pipeline (mocked external provider)", () => {
  it.each([429, 503])("uses bounded SDK retry behavior for HTTP %i without making live requests", async status => fixture(async () => {
    gemini();
    const options = fake.configure.mock.lastCall![0];
    const { GoogleGenAI } = await vi.importActual<typeof import("@google/genai")>("@google/genai");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: status, message: "Synthetic provider failure", status: status === 429 ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE" } }), { status, headers: { "Content-Type": "application/json" } })).mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), { headers: { "Content-Type": "application/json" } }));
    const client = new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, fetch: fetcher } });
    const request = client.models.generateContent({ model: "gemini-2.5-flash", contents: "Synthetic test" });
    if (status === 429) { await expect(request).rejects.toHaveProperty("status", 429); expect(fetcher).toHaveBeenCalledTimes(1); }
    else { expect((await request).text).toBe("OK"); expect(fetcher).toHaveBeenCalledTimes(2); }
  }));
  it("streams drafts, verifies cross-page evidence and saves final history", async () => fixture(async database => {
    fake.stream.mockResolvedValue((async function* () { yield { text: "Information must remain " }; yield { text: "confidential. [[C1]]" }; })());
    fake.complete.mockResolvedValue({ text: JSON.stringify({ citations: [{ id: "C1", documentId: "a", quote: "The parties shall keep information confidential." }] }) });
    const events: ChatEvent[] = []; await answer("parties confidential", ["a"], false, database, new AbortController().signal, event => events.push(event));
    expect(events.filter(event => event.type === "token")).toHaveLength(2); const final = database.history(["a"])[0]; expect(final.status).toBe("complete"); expect(final.citations[0].occurrences[0].segments).toHaveLength(2); expect(final.content).toContain("[[C1]]");
  }));
  it("rejects fabricated evidence even when the provider proposes it", async () => fixture(async database => {
    fake.stream.mockResolvedValue((async function* () { yield { text: "There is a million-dirham cap. [[C1]]" }; })()); fake.complete.mockResolvedValue({ text: JSON.stringify({ citations: [{ id: "C1", documentId: "a", quote: "Liability is capped at AED 1,000,000." }] }) });
    await answer("parties", ["a"], false, database, new AbortController().signal, () => {}); expect(database.history(["a"])[0].citations).toEqual([]); expect(database.history(["a"])[0].content).toContain("Insufficient verified evidence");
  }));
  it("cancels streaming and persists partial text as unverified", async () => fixture(async database => {
    fake.stream.mockResolvedValue((async function* () { yield { text: "Partial answer" }; yield { text: " should not display" }; })()); const controller = new AbortController();
    await answer("parties", ["a"], false, database, controller.signal, event => { if (event.type === "token") controller.abort(); }); const result = database.history(["a"])[0]; expect(result.status).toBe("cancelled"); expect(result.content).toBe("Partial answer"); expect(result.citations).toEqual([]); expect(fake.complete).not.toHaveBeenCalled();
  }));
  it("handles provider errors without claiming verified answers", async () => fixture(async database => { fake.stream.mockRejectedValue(new Error("Provider quota failure")); await answer("parties", ["a"], false, database, new AbortController().signal, () => {}); expect(database.history(["a"])[0].status).toBe("error"); }));
  it("identifies quota failures without exposing provider text or secrets", async () => fixture(async database => {
    fake.stream.mockRejectedValue(Object.assign(new Error("sensitive provider response"), { status: 429 }));
    const events: ChatEvent[] = [];
    await answer("parties", ["a"], false, database, new AbortController().signal, event => events.push(event));
    const error = events.find(event => event.type === "error");
    expect(error?.type === "error" && error.error).toContain("HTTP 429");
    expect(error?.type === "error" && error.error).not.toContain("sensitive");
  }));
  it("keeps malformed citation output unverified and identifies the validation stage", async () => fixture(async database => {
    fake.stream.mockResolvedValue((async function* () { yield { text: "Confidentiality applies. [[C1]]" }; })());
    fake.complete.mockResolvedValue({ text: '{"citations":[' });
    const events: ChatEvent[] = [];
    await answer("parties confidential", ["a"], false, database, new AbortController().signal, event => events.push(event));
    const final = database.history(["a"])[0];
    expect(final.status).toBe("error"); expect(final.citations).toEqual([]);
    const error = events.find(event => event.type === "error");
    expect(error?.type === "error" && error.error).toContain("malformed or incomplete");
  }));
  it("rejects a genuine quote outside the retrieved evidence", async () => fixture(async database => {
    fake.stream.mockResolvedValue((async function* () { yield { text: "The parties have obligations. [[C1]]" }; })());
    fake.complete.mockResolvedValue({ text: JSON.stringify({ citations: [{ id: "C1", documentId: "a", quote: "The parties shall" }] }) });
    await answer("confidential", ["a"], false, database, new AbortController().signal, () => {});
    expect(database.history(["a"])[0].citations).toEqual([]);
  }));
  it.each([150, 200])("answers from the final page of a dense %i-page source (mocked provider)", async count => fixture(async database => {
    const quote = "QUARTZ termination requires ninety days written notice.";
    const source = joinSegments(Array.from({ length: count }, (_, index) =>
      "Routine service delivery and record keeping obligations apply. ".repeat(80) + (index === count - 1 ? quote : "")), "pdf");
    database.finish("a", source.segments, source.text);
    fake.stream.mockResolvedValue((async function* () { yield { text: "QUARTZ termination requires ninety days notice. [[C1]]" }; })());
    fake.complete.mockResolvedValue({ text: JSON.stringify({ citations: [{ id: "C1", documentId: "a", quote }] }) });
    await answer("QUARTZ termination", ["a"], false, database, new AbortController().signal, () => {});
    const final = database.history(["a"])[0];
    expect(final.status).toBe("complete"); expect(final.citations[0].occurrences[0].segments[0].number).toBe(count);
    expect(final.coverage[0].fullyExamined).toBe(false);
  }));
});