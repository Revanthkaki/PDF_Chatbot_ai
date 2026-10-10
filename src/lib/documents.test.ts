import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import { extract, joinSegments, validateUpload } from "./extract";
import { Store } from "./store";

const directory = mkdtempSync(path.join(tmpdir(), "legal-tests-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe("document pipeline", () => {
  it("keeps insertion order when message timestamps are identical", () => {
    const database = new Store(path.join(directory, "message-order"));
    try {
      const user = database.message(["document"], "user", "Question");
      const assistant = database.message(["document"], "assistant", "Answer");
      database.db.prepare("UPDATE messages SET created=?").run("2026-10-10T00:00:00.000Z");
      database.db.prepare("UPDATE messages SET id=? WHERE id=?").run("z-user", user);
      database.db.prepare("UPDATE messages SET id=? WHERE id=?").run("a-assistant", assistant);
      expect(database.history(["document"]).map(message => message.role)).toEqual(["user", "assistant"]);
    } finally { database.db.close(); }
  });
  it("recovers an expired job lease after reopening and stops after three attempts", () => {
    const jobDirectory = path.join(directory, "recovery");
    let database = new Store(jobDirectory);
    database.add("job", "job", "Recovery.pdf", "pdf");
    expect(database.claim()).toBe("job");
    expect(database.claim()).toBeUndefined();
    database.db.close(); database = new Store(jobDirectory);
    try {
      expect(database.claim()).toBeUndefined();
      for (let attempt = 2; attempt <= 3; attempt++) {
        database.db.prepare("UPDATE documents SET lease=0 WHERE id=?").run("job");
        expect(database.claim()).toBe("job");
      }
      database.db.prepare("UPDATE documents SET lease=0 WHERE id=?").run("job");
      expect(database.claim()).toBeUndefined();
      expect(database.get("job")?.status).toBe("error");
    } finally { database.db.close(); }
  });
  it("reports incomplete coverage for image-only or blank pages in mixed PDFs", () => { const mixedDirectory = path.join(directory, "mixed"); const database = new Store(mixedDirectory); database.add("mixed", "mixed", "Mixed.pdf", "pdf"); const result = joinSegments(["Liability is capped at AED 100,000.", ""], "pdf"); database.finish("mixed", result.segments, result.text); expect(database.get("mixed")?.error).toContain("no extractable text"); expect(database.retrieve("liability", ["mixed"]).coverage[0].indexed).toBe(false); database.db.close(); });
  it("rejects invalid files and mismatched extensions", () => { expect(() => validateUpload("a.txt", new Uint8Array([1]))).toThrow(); expect(() => validateUpload("a.pdf", new TextEncoder().encode("fake pdf"))).toThrow(); expect(() => validateUpload("a.docx", new Uint8Array())).toThrow(); });
  it("extracts a real PDF with page references and rejects blank PDFs", async () => {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); pdf.addPage().drawText("Liability is capped at AED 100,000.", { font }); const bytes = await pdf.save();
    expect(validateUpload("test.pdf", bytes)).toBe("pdf"); const result = await extract(bytes, "pdf"); expect(result.segments[0].id).toBe("page-1"); expect(result.text).toContain("100,000");
    const blank = await PDFDocument.create(); blank.addPage(); await expect(extract(await blank.save(), "pdf")).rejects.toThrow("No usable text");
  });
  it("extracts real DOCX paragraphs", async () => { const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("1. Liability is capped at AED 100,000."), new Paragraph("2. Confidentiality applies for three years.")] }] })); expect(validateUpload("contract.docx", bytes)).toBe("docx"); const result = await extract(bytes, "docx"); expect(result.segments).toHaveLength(2); expect(result.segments[1].id).toBe("paragraph-2"); });
  it.each([150, 200])("persists and retrieves deep chunks from a dense %i-page contract without claiming full coverage", count => {
    const largeDirectory = path.join(directory, `large-${count}`);
    let database = new Store(largeDirectory); database.add("large", "hash", "Large.pdf", "pdf");
    const result = joinSegments(Array.from({ length: count }, (_, index) =>
      `Page ${index + 1}. ` + "Supplier records general administration obligations and routine delivery terms. ".repeat(70) +
      (index === count - 1 ? "Final-page termination requires ninety days written notice. QUARTZ escalation uses quartz@example.invalid." : "")), "pdf");
    database.finish("large", result.segments, result.text); database.db.close(); database = new Store(largeDirectory);
    const search = database.retrieve("QUARTZ escalation", ["large"]); expect(search.evidence[0].segment).toBe(count); expect(search.coverage[0].fullyExamined).toBe(false); expect(database.get("large")?.pages).toBe(count);
    expect(search.coverage[0].totalChunks).toBeGreaterThan(count * 2);
    for (const item of search.evidence) expect(result.text.slice(item.start, item.end)).toBe(item.text);
    expect(database.section("large", count).map(item => item.text).join(" ")).toContain("ninety days");
    expect(database.retrieve("absentuniquesentinel", ["large"]).evidence).toEqual([]);
    database.message(["large"], "user", "Notice?"); const id = database.message(["large"], "assistant", ""); database.saveMessage(id, "Partial output", "cancelled"); expect(database.history(["large"])[1].content).toBe("Partial output"); database.delete("large"); expect(database.history(["large"])).toEqual([]); database.db.close();
  });
});