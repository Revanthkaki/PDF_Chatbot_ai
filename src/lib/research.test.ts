import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "./store";
import { joinSegments } from "./extract";
import { executeTool, research } from "./research";
describe("research tools", () => {
  it("validates tool names, arguments and selection; enforces three rounds and six calls", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "research-")); const database = new Store(directory);
    try {
      database.add("a", "a", "A", "docx"); const result = joinSegments(["Liability is capped at AED 100,000."], "docx"); database.finish("a", result.segments, result.text);
      expect(executeTool("invented", {}, ["a"], database).result).toHaveProperty("error"); expect(executeTool("search_document", { query: "cap", document_ids: ["other"] }, ["a"], database).result).toHaveProperty("error"); expect(executeTool("get_section", { document_id: "a", section_number: "bad" }, ["a"], database).result).toHaveProperty("error");
      let iterations = 0; const activity: string[] = [];
      const output = await research("cap", ["a"], database, async contents => { iterations++; if (iterations > 1) expect(JSON.stringify(contents)).toContain("functionResponse"); const calls = [{ name: "search_document", args: { query: "liability", document_ids: ["a"] } }, { name: "get_section", args: { document_id: "a", section_number: 1 } }]; return { content: { role: "model", parts: calls.map(functionCall => ({ functionCall })) }, calls }; }, new AbortController().signal, text => activity.push(text));
      expect(iterations).toBe(3); expect(output.calls).toBe(6); expect(output.evidence).toHaveLength(1); expect(activity.at(-1)).toContain("limit reached");
      const controller = new AbortController(); controller.abort(); await expect(research("cap", ["a"], database, async () => { throw new Error("should not call"); }, controller.signal, () => {})).rejects.toThrow();
    } finally { database.db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});