import { afterEach, describe, expect, it, vi } from "vitest";
import { groq, groqMessages } from "./groq";
import { aiConfigured, answer, modelName, providerName } from "./ai";
import { Store } from "./store";
import { joinSegments } from "./extract";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fake = vi.hoisted(() => ({ create: vi.fn(), configure: vi.fn() }));
vi.mock("groq-sdk", () => ({ default: class { constructor(options: unknown) { fake.configure(options); } chat = { completions: { create: fake.create } }; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Groq adapter (mocked provider)", () => {
  it("selects Groq and requires its own key", () => {
    vi.stubEnv("AI_PROVIDER", "groq"); vi.stubEnv("GROQ_API_KEY", "");
    expect(providerName()).toBe("Groq"); expect(aiConfigured()).toBe(false);
    expect(() => groq()).toThrow("GROQ_API_KEY");
    expect(modelName()).toBe("openai/gpt-oss-120b");
  });
  it("preserves tool call IDs and returns results as tool messages", () => {
    expect(groqMessages([
      { role: "user", parts: [{ text: "Research" }] },
      { role: "model", parts: [{ functionCall: { id: "call_1", name: "search_document", args: { query: "cap" } } }] },
      { role: "user", parts: [{ functionResponse: { id: "call_1", name: "search_document", response: { evidence: [] } } }] },
    ])).toMatchObject([{ role: "user" }, { role: "assistant", tool_calls: [{ id: "call_1" }] }, { role: "tool", tool_call_id: "call_1", content: '{"evidence":[]}' }]);
  });
  it("streams tokens, forwards cancellation, and requests JSON citations", async () => {
    vi.stubEnv("GROQ_API_KEY", "isolated-test-key");
    fake.create.mockResolvedValueOnce((async function* () { yield { choices: [{ delta: { content: "Hello" } }] }; })()).mockResolvedValueOnce({ choices: [{ message: { content: '{"citations":[]}' } }] });
    const client = groq(); const controller = new AbortController();
    const stream = await client.models.generateContentStream({ model: "test", contents: "Question", config: { abortSignal: controller.signal } });
    const chunks = []; for await (const chunk of stream) chunks.push(chunk.text);
    expect(chunks).toEqual(["Hello"]);
    expect(fake.create.mock.calls[0][1].signal).toBe(controller.signal);
    const response = await client.models.generateContent({ model: "test", contents: "Return JSON", config: { responseMimeType: "application/json" } });
    expect(response.text).toBe('{"citations":[]}');
    expect(fake.create.mock.calls[1][0].response_format).toEqual({ type: "json_object" });
  });
  it("returns malformed tool arguments for safe validation rather than crashing", async () => {
    vi.stubEnv("GROQ_API_KEY", "isolated-test-key");
    fake.create.mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: "bad", function: { name: "search_document", arguments: "{" } }] } }] });
    const response = await groq().models.generateContent({ model: "test", contents: "Research", config: { tools: [{}] } });
    expect(response.functionCalls[0].args).toEqual({ invalidArguments: true });
    expect(fake.create.mock.calls[0][0].tools).toHaveLength(4);
  });
  it.each([false, true])("completes the verified answer pipeline with research=%s", async research => {
    vi.stubEnv("AI_PROVIDER", "groq"); vi.stubEnv("GROQ_API_KEY", "isolated-test-key");
    const directory = mkdtempSync(path.join(tmpdir(), "groq-tests-"));
    const database = new Store(directory);
    try {
      database.add("source", "source", "Synthetic.pdf", "pdf");
      const quote = "Liability is capped at AED 100,000.";
      const source = joinSegments([quote], "pdf"); database.finish("source", source.segments, source.text);
      if (research) {
        fake.create.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: "lookup", function: { name: "search_document", arguments: JSON.stringify({ query: "liability", document_ids: ["source"] }) } }] } }] });
        fake.create.mockResolvedValueOnce({ choices: [{ message: { content: "Enough evidence retrieved." } }] });
      }
      fake.create.mockResolvedValueOnce((async function* () { yield { choices: [{ delta: { content: "The cap is AED 100,000. [[C1]]" } }] }; })());
      fake.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ citations: [{ id: "C1", documentId: "source", quote }] }) } }] });
      await answer("liability cap", ["source"], research, database, new AbortController().signal, () => {});
      const final = database.history(["source"])[0];
      expect(final.status).toBe("complete"); expect(final.citations[0].quote).toBe(quote);
      if (research) {
        expect(fake.create.mock.calls[1][0].messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "lookup" }));
        expect(final.activity.some(text => text.startsWith("Tool "))).toBe(true);
      }
    } finally { database.db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});