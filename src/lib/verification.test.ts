import { describe, expect, it } from "vitest";
import { groundedAnswer, locateQuote, normalizeWithMap, verifyCitations } from "./verification";
import type { Contract } from "./types";

const text = "Liability is capped at AED 100,000.\n\nThe parties shall\nkeep information confidential.\n\nLiability is capped at AED 100,000.";
const split = text.indexOf("keep");
const document: Contract = { id: "a", name: "Original", kind: "pdf", status: "ready", error: null, created: "", pages: 2, characters: text.length, text, segments: [{ id: "page-1", number: 1, text: text.slice(0, split), start: 0, end: split }, { id: "page-2", number: 2, text: text.slice(split), start: split, end: text.length }] };
describe("exact quotation verification", () => {
  it("preserves whitespace source positions", () => { expect(normalizeWithMap("  a\n \tb ").text).toBe("a b"); expect(locateQuote(document, "The parties shall keep information confidential.")[0].segments).toHaveLength(2); });
  it("returns all duplicate occurrences", () => { expect(locateQuote(document, "Liability is capped at AED 100,000.")).toHaveLength(2); });
  it("rejects fabrication, paraphrase and wrong document", () => { expect(locateQuote(document, "Liability is capped at AED 1,000,000.")).toEqual([]); expect(locateQuote(document, "The parties must keep information private.")).toEqual([]); expect(verifyCitations([{ id: "C1", documentId: "other", quote: "Liability is capped at AED 100,000." }], [document])).toEqual([]); });
  it("retains only paragraphs backed by verified citations", () => { const citations = verifyCitations([{ id: "C1", documentId: "a", quote: "Liability is capped at AED 100,000." }], [document]); expect(groundedAnswer("Cap is AED 100,000. [[C1]]\n\nThere is no indemnity. [[C2]]", citations)).toBe("Cap is AED 100,000. [[C1]]"); });
});