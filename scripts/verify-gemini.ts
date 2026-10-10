import { chromium, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Citation, Contract } from "../src/lib/types";

async function verifyLargeDocuments(base: string) {
  const results: { check: string; seconds: number; citations: number; tools: number }[] = [];
  const documents: Contract[] = [];
  for (const [count, version] of [[150, "original"], [200, "original"], [200, "revised"]] as const) {
    const filename = `Synthetic-${count}-pages-${version}.pdf`;
    const bytes = readFileSync(`data/qa-fixtures/${filename}`);
    const form = new FormData(); form.append("file", new File([bytes], filename, { type: "application/pdf" }));
    const started = Date.now();
    const upload = await fetch(`${base}/api/documents`, { method: "POST", body: form });
    if (!upload.ok) throw new Error(`Large fixture upload failed (${upload.status}).`);
    const { id } = await upload.json();
    await expect.poll(async () => {
      const document = await (await fetch(`${base}/api/documents/${id}`)).json();
      if (document.status === "error") throw new Error(document.error);
      return document.status;
    }, { timeout: 120_000 }).toBe("ready");
    const document: Contract = await (await fetch(`${base}/api/documents/${id}`)).json();
    expect(document.pages).toBe(count);
    expect(document.characters).toBeGreaterThan(count * 3000);
    documents.push(document);
    console.log(`${filename}: ${document.pages} real pages; ${document.characters} extracted characters; ${((Date.now() - started) / 1000).toFixed(1)}s upload/indexing.`);
  }
  const checks = [
    { name: "150-page final-page answer", documents: [documents[0]], research: false, question: "What is the final-page termination notice period? Quote the exact final-page termination provision.", sections: [150] },
    { name: "200-page final-page answer", documents: [documents[1]], research: false, question: "What is the QUARTZ escalation address? Quote the exact source provision.", sections: [200] },
    { name: "200-page research", documents: [documents[1]], research: true, question: "Use research tools to inspect section 200, then explain the final-page termination notice and QUARTZ escalation address with exact quotes.", sections: [200] },
    { name: "200-page cross-version answer", documents: [documents[1], documents[2]], research: false, question: "Compare the penultimate-page liability caps in both contracts. Quote the exact liability amount from each and explain the difference.", sections: [199, 199] },
  ];
  for (const check of checks) {
    const started = Date.now();
    const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentIds: check.documents.map(document => document.id), question: check.question, research: check.research }), signal: AbortSignal.timeout(250_000) });
    if (!response.ok) throw new Error(`${check.name}: HTTP ${response.status}.`);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    const final = events.findLast(event => event.type === "done");
    expect(final?.status, `${check.name}: ${events.find(event => event.type === "error")?.error || "No completed answer"}`).toBe("complete");
    const citations: Citation[] = final.citations;
    check.documents.forEach((document, index) => {
      const expected = citations.filter(citation => citation.documentId === document.id && citation.occurrences.some(occurrence => occurrence.segments.some(segment => segment.number === check.sections[index])));
      expect(expected.length, `${check.name}: missing citation from expected late page`).toBeGreaterThan(0);
      for (const citation of expected) for (const occurrence of citation.occurrences) expect(document.text.slice(occurrence.start, occurrence.end)).toBe(citation.quote);
    });
    const tools = events.filter(event => event.type === "activity" && event.text.startsWith("Tool "));
    if (check.research) { expect(tools.length).toBeGreaterThan(0); expect(tools.length).toBeLessThanOrEqual(6); }
    expect(events.some(event => event.type === "token")).toBe(true);
    const coverage = events.find(event => event.type === "coverage");
    expect(coverage.coverage.every((item: { fullyExamined: boolean; totalChunks: number; retrievedChunks: number }) => !item.fullyExamined && item.totalChunks > item.retrievedChunks)).toBe(true);
    const result = { check: check.name, seconds: (Date.now() - started) / 1000, citations: citations.length, tools: tools.length };
    results.push(result); console.log(JSON.stringify(result));
  }
  writeFileSync("data/qa-fixtures/live-results.json", JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
}

async function run() {
  const base = process.env.TEST_BASE_URL || "http://localhost:3000";
  const config = await (await fetch(`${base}/api/documents`)).json();
  if (!config.configured) throw new Error(`Live ${config.provider || "AI"} verification blocked: enter a replacement ${config.provider === "Groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"} directly in .env.local and restart. No provider request was made.`);
  if (process.argv.includes("--large")) { await verifyLargeDocuments(base); return; }
  const document = config.documents.find((document: { name: string; status: string }) => document.name === "Example Original.pdf" && document.status === "ready");
  if (!document) throw new Error("Run npm run test:e2e first to upload the synthetic Example Original.pdf fixture.");
  for (const research of [false, true]) {
    const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentIds: [document.id], question: research ? "Use research tools to inspect liability and termination provisions, then explain their relationship with exact evidence." : "What is the liability cap? Use an exact supporting quotation.", research }), signal: AbortSignal.timeout(250_000) });
    if (!response.ok) throw new Error((await response.json()).error);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    const final = events.findLast(event => event.type === "done");
    if (!final || final.status !== "complete" || !final.citations.length) throw new Error(`Live ${config.provider || "AI"} did not return a completed answer with verified evidence. ${events.find(event => event.type === "error")?.error || "Inspect the saved partial response."}`);
    const tools = events.filter(event => event.type === "activity" && event.text.startsWith("Tool "));
    if (research && (!tools.length || tools.length > 6)) throw new Error("Live research did not demonstrate tool use within the six-call limit.");
    console.log(`${research ? "Research" : "Ordinary chat"}: real provider completed; ${final.citations.length} source-verified citation(s), ${tools.length} tool call(s).`);
  }
  mkdirSync("docs/screenshots", { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(base);
    await page.locator(".document-button").filter({ hasText: "Example Original.pdf" }).first().click();
    await page.locator(".evidence-card").first().waitFor(); await page.screenshot({ path: "docs/screenshots/chat-verified.png", fullPage: true });
    await page.locator(".citation-chip").first().click(); await page.locator(".pdf-highlight").first().waitFor(); await page.screenshot({ path: "docs/screenshots/chat-highlight.png", fullPage: true });
    await page.locator(".research-activity").last().evaluate(element => { (element as HTMLDetailsElement).open = true; }); await page.screenshot({ path: "docs/screenshots/research-live.png", fullPage: true });
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error instanceof Error ? error.message : "Live verification failed."); process.exitCode = 1; });