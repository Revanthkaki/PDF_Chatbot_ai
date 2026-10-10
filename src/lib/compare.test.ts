import { describe, expect, it } from "vitest";
import type { Contract } from "./types";
import { joinSegments } from "./extract";
import { compareContracts } from "./compare";
function doc(id: string, paragraphs: string[]): Contract { const result = joinSegments(paragraphs, "docx"); return { id, name: id, kind: "docx", status: "ready", error: null, created: "", pages: paragraphs.length, characters: result.text.length, ...result }; }
describe("substantive comparison", () => {
  it("does not treat clause renumbering as a changed liability limit", () => {
    const result = compareContracts(doc("old", ["1. Liability is capped at AED 100,000."]), doc("new", ["8. Liability is capped at AED 100,000."]));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].significance).toBe("Low");
    expect(result.changes[0].explanation).toContain("provision text is unchanged");
    expect(result.changes[0].explanation).not.toContain("Numeric terms changed");
  });
  it("rates added exceptions as substantive", () => {
    const result = compareContracts(doc("old", ["Confidentiality applies to exchanged information."]), doc("new", ["Confidentiality applies except to exchanged information."]));
    expect(result.changes[0].significance).toBe("High");
    expect(result.changes[0].explanation).toContain("Obligation or permission language changed");
  });
  it.each([
    ["Termination requires thirty days written notice.", "Termination requires ninety days written notice."],
    ["Confidentiality applies for twenty-one days.", "Confidentiality applies for sixty days."],
    ["Services must continue for 30 calendar days.", "Services must continue for 30 business days."],
  ])("treats duration changes as substantive: %s", (before, after) => {
    const result = compareContracts(doc("old", [before]), doc("new", [after]));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].significance).toBe("High");
    expect(result.changes[0].explanation).toContain("Notice periods or durations:");
  });
  it("does not rate a changed liability party as a cosmetic edit", () => {
    const result = compareContracts(doc("old", ["Liability applies to the supplier."]), doc("new", ["Liability applies to the customer."]));
    expect(result.changes[0].significance).not.toBe("Low");
  });
  it("reports bounded coverage when the paragraph budget is exceeded", () => {
    const paragraphs = Array.from({ length: 12001 }, (_, index) => `General administrative provision ${index + 1}.`);
    const revised = [...paragraphs]; revised[12000] = "Termination requires ninety days written notice.";
    const result = compareContracts(doc("old", paragraphs), doc("new", revised));
    expect(result.complete).toBe(false);
    expect(result.examinedOriginal).toBe(12000); expect(result.examinedRevised).toBe(12000);
    expect(result.originalClauses).toBe(12001); expect(result.revisedClauses).toBe(12001);
  });
  it("treats a tenfold liability cap change as High", () => { const result = compareContracts(doc("old", ["1. Liability is capped at AED 100,000."]), doc("new", ["1. Liability is capped at AED 1,000,000."])); expect(result.changes).toHaveLength(1); expect(result.changes[0].significance).toBe("High"); expect(result.changes[0].explanation).toContain("AED 1,000,000"); expect(result.changes[0].originalOccurrences).toHaveLength(1); });
  it("detects additions, removals, and cosmetic changes", () => { const result = compareContracts(doc("old", ["1. General terms apply.", "2. Indemnity must be provided by the supplier."]), doc("new", ["1. General terms apply!", "3. Termination requires thirty days notice."])); expect(result.changes.some(change => change.significance === "Low")).toBe(true); expect(result.changes.some(change => change.type === "removed" && change.topic === "Indemnity")).toBe(true); expect(result.changes.some(change => change.type === "added" && change.topic === "Termination")).toBe(true); });
  it("retrieves independently per selected document", async () => { const { Store } = await import("./store"); const { mkdtempSync, rmSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const directory = mkdtempSync(tmpdir() + "/comparison-"); const database = new Store(directory); try { for (const document of [doc("old", ["Liability capped at AED 100,000."]), doc("new", ["Liability capped at AED 1,000,000."])]) { database.add(document.id, document.id, document.name, document.kind); database.finish(document.id, document.segments, document.text); } expect(new Set(database.retrieve("liability", ["old", "new"]).evidence.map(item => item.documentId)).size).toBe(2); } finally { database.db.close(); rmSync(directory, { recursive: true, force: true }); } });
});