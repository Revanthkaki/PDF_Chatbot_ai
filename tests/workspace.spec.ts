import { test, expect, type APIRequestContext } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import { mkdirSync, writeFileSync } from "node:fs";
import { verifyCitations } from "../src/lib/verification";
import type { Contract } from "../src/lib/types";

let originalId: string;
let revisedId: string;
let docxId: string;
async function pdf(amount: string, count = 2) {
  const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= count; number++) {
    const page = document.addPage([595, 842]);
    const lines = count >= 150 ? [
      `SYNTHETIC QA CONTRACT - Page ${number} of ${count}`,
      ...Array.from({ length: 38 }, (_, index) => `${number}.${index + 1} Supplier records service delivery and routine audit obligations for both parties.`),
      ...(number === count - 1 ? [`Penultimate-page liability is capped at AED ${amount || "100,000"}.`] : []),
      ...(number === count ? ["Final-page termination requires ninety days written notice.", "The QUARTZ escalation address is quartz@example.invalid."] : []),
    ] : number === 1 ? ["MASTER SERVICES AGREEMENT", "1. Liability", `Liability is capped at AED ${amount}.`, "2. Confidentiality", "The parties shall keep all information confidential."] : ["3. Termination", "Either party may terminate on thirty days written notice.", "4. Repeated liability provision", `Liability is capped at AED ${amount}.`];
    lines.forEach((line, index) => page.drawText(line, { x: 45, y: 780 - index * (count >= 150 ? 16 : 40), size: count >= 150 ? 10 : index === 0 && number === 1 ? 18 : 12, font }));
  }
  const bytes = Buffer.from(await document.save());
  if (count >= 150) {
    mkdirSync("data/qa-fixtures", { recursive: true });
    writeFileSync(`data/qa-fixtures/Synthetic-${count}-pages-${amount === "1,000,000" ? "revised" : "original"}.pdf`, bytes);
  }
  return bytes;
}
async function upload(request: APIRequestContext, name: string, buffer: Buffer) {
  const response = await request.post("/api/documents", { multipart: { file: { name, mimeType: name.endsWith("pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer } } });
  expect(response.ok()).toBeTruthy(); const { id } = await response.json();
  await expect.poll(async () => (await (await request.get(`/api/documents/${id}`)).json()).status, { timeout: 60_000 }).toBe("ready");
  return id;
}
test.beforeAll(async ({ request }) => {
  mkdirSync("docs/screenshots", { recursive: true });
  originalId = await upload(request, "Example Original.pdf", await pdf("100,000"));
  revisedId = await upload(request, "Example Revised.pdf", await pdf("1,000,000"));
  docxId = await upload(request, "Example Services.docx", await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("MASTER SERVICES AGREEMENT"), new Paragraph("1. Liability is capped at AED 100,000."), new Paragraph("2. Confidentiality applies to all exchanged information."), new Paragraph("3. Either party may terminate with thirty days written notice.")] }] })));
});
test("invalid and unreadable files receive clear errors", async ({ request }) => {
  const invalid = await request.post("/api/documents", { multipart: { file: { name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") } } }); expect(invalid.status()).toBe(400); expect((await invalid.json()).error).toContain("PDF and DOCX");
  const blank = await PDFDocument.create(); blank.addPage(); const response = await request.post("/api/documents", { multipart: { file: { name: "Blank.pdf", mimeType: "application/pdf", buffer: Buffer.from(await blank.save()) } } }); const { id } = await response.json();
  await expect.poll(async () => (await (await request.get(`/api/documents/${id}`)).json()).status).toBe("error"); expect((await (await request.get(`/api/documents/${id}`)).json()).error).toContain("No usable text"); await request.delete(`/api/documents/${id}`);
});
test("library survives reload and real PDF pixels and text layer render", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.locator(".document-button").filter({ hasText: "Example Original.pdf" }).first().click();
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.locator(".pdf-page canvas").first().evaluate((canvas: HTMLCanvasElement) => { const context = canvas.getContext("2d"); if (!context) return 0; const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 150 && pixels[index + 3] > 0) dark++; return dark; })).toBeGreaterThan(100);
  await page.screenshot({ path: "docs/screenshots/document-library.png", fullPage: true });
  await page.reload(); await expect(page.locator(".document-button").filter({ hasText: "Example Original.pdf" }).first()).toBeVisible(); expect(errors).toEqual([]);
});
test("comparison detects major monetary changes and highlights original PDF source", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByLabel("Original contract", { exact: true }).selectOption(originalId); await page.getByLabel("Revised contract", { exact: true }).selectOption(revisedId); await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.locator(".change").first()).toBeVisible(); await expect(page.locator(".significance-badge.high").first()).toBeVisible(); await expect(page.getByText(/Monetary amounts: AED 100,000 -> AED 1,000,000/).first()).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/comparison.png", fullPage: true });
  await page.getByRole("button", { name: "Low", exact: true }).click(); await expect(page.getByText("No changes match this filter")).toBeVisible(); await page.getByRole("button", { name: "All", exact: true }).click();
  await page.locator(".change-source.original").first().click(); await expect(page.locator(".pdf-highlight").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "docs/screenshots/pdf-highlight.png", fullPage: true });
});
test("DOCX navigation, multi-document selection and missing-key error", async ({ page, request }) => {
  await page.goto("/"); await page.locator(".document-button").filter({ hasText: "Example Services.docx" }).first().click(); await expect(page.locator('[data-source-id="paragraph-2"]')).toContainText("AED 100,000");
  await page.getByRole("spinbutton", { name: "Source section number" }).fill("3"); await expect(page.getByRole("spinbutton", { name: "Source section number" })).toHaveValue("3");
  await page.getByRole("checkbox", { name: "Select Example Original.pdf", exact: true }).first().check(); await expect(page.getByText("2 documents selected")).toBeVisible();
  const config = await (await request.get("/api/documents")).json();
  if (!config.configured) { const response = await request.post("/api/chat", { data: { documentIds: [docxId], question: "What is the cap?" } }); expect(response.status()).toBe(400); expect((await response.json()).error).toContain(`${config.provider || "Gemini"} is not configured`); }
  await page.screenshot({ path: "docs/screenshots/docx-workspace.png", fullPage: true });
});
for (const count of [150, 200]) {
  test(`dense ${count}-page PDF uploads, indexes, renders and highlights its final page`, async ({ page, request }) => {
    const name = `Synthetic ${count}-page QA.pdf`;
    const bytes = await pdf("100,000", count);
    const id = await upload(request, name, bytes);
    try {
      const document: Contract = await (await request.get(`/api/documents/${id}`)).json();
      expect(document.pages).toBe(count);
      expect(document.text.length).toBeGreaterThan(count * 3000);
      expect(document.segments[count - 1].text).toContain("ninety days");
      const duplicate = await request.post("/api/documents", { multipart: { file: { name, mimeType: "application/pdf", buffer: bytes } } });
      expect(await duplicate.json()).toMatchObject({ id, duplicate: true });
      const citations = verifyCitations([{ id: "C1", documentId: id, quote: "Final-page termination requires ninety days written notice." }], [document]);
      expect(citations[0].occurrences[0].segments[0].number).toBe(count);
      await page.route("**/api/history?*", route => route.fulfill({ json: { messages: [{ id: "large-fixture", role: "assistant", content: "TEST HARNESS: final-page source navigation, not an AI answer. [[C1]]", status: "complete", citations, activity: [], coverage: [], created: "" }] } }));
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto("/");
      await page.locator(".document-button").filter({ hasText: name }).click();
      await page.locator(".citation-chip").click();
      const finalPage = page.locator(`[data-source-id="page-${count}"]`);
      await expect(finalPage.locator(".pdf-highlight").first()).toBeVisible({ timeout: 30_000 });
      await expect(finalPage.locator(".pdf-highlight").first()).toBeInViewport();
      await expect(page.getByRole("spinbutton", { name: "Source section number" })).toHaveValue(String(count));
      expect(await page.getByRole("spinbutton", { name: "Source section number" }).evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(60);
      await expect(finalPage.locator(".textLayer")).toContainText("QUARTZ");
      expect(await finalPage.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let darkPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 150 && pixels[index + 3] > 0) darkPixels++;
        return darkPixels;
      })).toBeGreaterThan(1000);
      expect(await page.locator(".pdf-page canvas").evaluateAll(canvases => canvases.filter(canvas => (canvas as HTMLCanvasElement).width > 300).length)).toBeLessThan(20);
      const initialWidth = await finalPage.evaluate(element => element.getBoundingClientRect().width);
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect.poll(() => finalPage.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
      await expect(finalPage.locator(".pdf-highlight").first()).toBeInViewport();
      expect(errors).toEqual([]);
      await page.screenshot({ path: `docs/screenshots/qa-${count}-page-highlight.png`, fullPage: true });
    } finally { await request.delete(`/api/documents/${id}`); }
  });
}
test("200-page comparison detects the liability change on page 199", async ({ request }) => {
  const original = await upload(request, "Synthetic 200-page original.pdf", await pdf("100,000", 200));
  const revised = await upload(request, "Synthetic 200-page revised.pdf", await pdf("1,000,000", 200));
  try {
    const response = await request.post("/api/compare", { data: { originalId: original, revisedId: revised } });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.complete).toBe(true);
    const change = result.changes.find((change: { explanation: string }) => change.explanation.includes("AED 1,000,000"));
    expect(change.significance).toBe("High");
    expect(change.originalOccurrences[0].segments[0].number).toBe(199);
    expect(change.revisedOccurrences[0].segments[0].number).toBe(199);
  } finally { await request.delete(`/api/documents/${original}`); await request.delete(`/api/documents/${revised}`); }
});
test("mobile workspace has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/"); await page.getByRole("button", { name: "Toggle document library" }).click(); await page.locator(".document-button").filter({ hasText: "Example Services.docx" }).first().click(); await expect(page.locator(".docx-document")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "docs/screenshots/mobile-workspace.png", fullPage: true });
});
test("isolated citation fixture navigates repeated and cross-page PDF quotes", async ({ page, request }) => {
  const document: Contract = await (await request.get(`/api/documents/${originalId}`)).json();
  const citations = verifyCitations([{ id: "C1", documentId: originalId, quote: "Liability is capped at AED 100,000." }, { id: "C2", documentId: originalId, quote: "The parties shall keep all information confidential. 3. Termination Either party may terminate on thirty days written notice." }], [document]);
  expect(citations).toHaveLength(2); expect(citations[0].occurrences).toHaveLength(2); expect(citations[1].occurrences[0].segments).toHaveLength(2);
  await page.route("**/api/history?*", route => route.fulfill({ json: { messages: [{ id: "fixture", role: "assistant", content: "TEST HARNESS: source-navigation fixture, not an AI answer. [[C1]] [[C2]]", status: "complete", citations, activity: [], coverage: [], created: "" }] } }));
  await page.goto("/"); await page.locator(".document-button").filter({ hasText: "Example Original.pdf" }).first().click();
  await expect(page.getByLabel("Quote occurrence")).toBeVisible(); await page.getByLabel("Quote occurrence").selectOption("1");
  await expect(page.locator('[data-source-id="page-2"] .pdf-highlight').first()).toBeVisible({ timeout: 30_000 }); await expect(page.locator('[data-source-id="page-1"] .pdf-highlight')).toHaveCount(0);
  await page.locator(".citation-chip").filter({ hasText: "C2" }).click(); await expect(page.locator('[data-source-id="page-1"] .pdf-highlight').first()).toBeVisible(); await expect(page.locator('[data-source-id="page-2"] .pdf-highlight')).toHaveCount(2);
});
test("isolated citation fixture highlights exact DOCX text", async ({ page, request }) => {
  const document: Contract = await (await request.get(`/api/documents/${docxId}`)).json(); const citations = verifyCitations([{ id: "C1", documentId: docxId, quote: "Liability is capped at AED 100,000." }], [document]);
  await page.route("**/api/history?*", route => route.fulfill({ json: { messages: [{ id: "fixture", role: "assistant", content: "TEST HARNESS: source-navigation fixture, not an AI answer. [[C1]]", status: "complete", citations, activity: [], coverage: [], created: "" }] } }));
  await page.goto("/"); await page.locator(".document-button").filter({ hasText: "Example Services.docx" }).first().click(); await page.locator(".citation-chip").click(); await expect(page.getByTestId("docx-highlight")).toHaveText("Liability is capped at AED 100,000.");
});
test("malformed requests and cross-origin writes are rejected before generation", async ({ request }) => {
  for (const body of [
    { documentIds: [originalId], question: "" },
    { documentIds: ["not-a-uuid"], question: "Question" },
    { documentIds: Array(7).fill(originalId), question: "Question" },
  ]) {
    const response = await request.post("/api/chat", { data: body });
    expect(response.status()).toBe(400);
  }
  const same = await request.post("/api/compare", { data: { originalId, revisedId: originalId } });
  expect(same.status()).toBe(400); expect((await same.json()).error).toContain("different");
  for (const endpoint of ["documents", "chat", "compare"]) {
    const response = await request.post(`/api/${endpoint}`, { headers: { Origin: "https://untrusted.example" }, data: {} });
    expect(response.status()).toBe(400); expect((await response.json()).error).toContain("Cross-origin");
  }
});
test("mixed blank/text PDF warns about coverage, downloads intact, and deletes cleanly", async ({ request }) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("Synthetic mixed-file liability is capped at AED 345,678.", { font });
  document.addPage();
  const bytes = Buffer.from(await document.save());
  const id = await upload(request, "Mixed readable and blank QA.pdf", bytes);
  try {
    const result = await (await request.get(`/api/documents/${id}`)).json();
    expect(result.pages).toBe(2); expect(result.error).toContain("no extractable text");
    const download = await request.get(`/api/documents/${id}/file`);
    expect(download.headers()["content-type"]).toBe("application/pdf");
    expect(await download.body()).toEqual(bytes);
  } finally { expect((await request.delete(`/api/documents/${id}`)).ok()).toBe(true); }
  expect((await request.get(`/api/documents/${id}`)).status()).toBe(404);
  expect((await request.get(`/api/documents/${id}/file`)).status()).toBe(404);
});
test("landscape, rotated and mixed-font multiline PDF quotes map to visible highlights", async ({ page, request }) => {
  const file = await PDFDocument.create();
  const regular = await file.embedFont(StandardFonts.Helvetica);
  const bold = await file.embedFont(StandardFonts.HelveticaBold);
  const landscape = file.addPage([842, 595]);
  landscape.drawText("The supplier shall keep", { x: 50, y: 500, size: 14, font: bold });
  landscape.drawText("all information confidential.", { x: 50, y: 470, size: 12, font: regular });
  landscape.drawText("Separate column: Fees are payable monthly.", { x: 420, y: 500, size: 12, font: regular });
  const rotated = file.addPage([595, 842]); rotated.setRotation(degrees(90));
  rotated.drawText("Termination requires sixty days written notice.", { x: 50, y: 700, size: 12, font: regular });
  const id = await upload(request, "Layout edge cases QA.pdf", Buffer.from(await file.save()));
  try {
    const source: Contract = await (await request.get(`/api/documents/${id}`)).json();
    const citations = verifyCitations([
      { id: "C1", documentId: id, quote: "The supplier shall keep all information confidential." },
      { id: "C2", documentId: id, quote: "Termination requires sixty days written notice." },
    ], [source]);
    expect(citations).toHaveLength(2);
    await page.route("**/api/history?*", route => route.fulfill({ json: { messages: [{ id: "layout-fixture", role: "assistant", content: "TEST HARNESS: PDF layout navigation, not an AI answer. [[C1]] [[C2]]", status: "complete", citations, activity: [], coverage: [], created: "" }] } }));
    await page.goto("/"); await page.locator(".document-button").filter({ hasText: "Layout edge cases QA.pdf" }).click();
    for (const [index, number] of [[0, 1], [1, 2]]) {
      await page.locator(".citation-chip").nth(index).click();
      const marks = page.locator(`[data-source-id="page-${number}"] .pdf-highlight`);
      await expect(marks.first()).toBeInViewport({ timeout: 30000 });
      expect(await marks.count()).toBeGreaterThanOrEqual(number === 1 ? 2 : 1);
      await expect(page.getByText("No potentially wrong highlight was drawn.", { exact: false })).toHaveCount(0);
    }
    await page.screenshot({ path: "docs/screenshots/qa-rotated-highlight.png", fullPage: true });
  } finally { await request.delete(`/api/documents/${id}`); }
});
test("provider text hydrates consistently on initial load and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [], configured: false, provider: "Groq", model: "llama-3.3-70b-versatile" } }));
  await page.goto("/");
  await expect(page.locator(".sidebar-footer")).toContainText("Retrieved passages sent to Groq.");
  await expect(page.locator(".configuration-note")).toContainText("GROQ_API_KEY");
  await page.reload();
  await expect(page.locator(".sidebar-footer")).toContainText("Retrieved passages sent to Groq.");
  await expect(page.locator(".composer-footer")).toContainText("Groq");
  expect(errors.filter(error => /hydrat|server rendered|didn't match/i.test(error))).toEqual([]);
});