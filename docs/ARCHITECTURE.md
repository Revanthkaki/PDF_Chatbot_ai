# Architecture

## Processing

The upload route validates file size, extension and magic bytes, calculates a SHA-256 digest, stores the original under a random document UUID, then inserts a persistent SQLite processing record. Duplicate bytes return the existing record. Original filenames are metadata, never storage paths.

The independently running worker claims a queued record in a SQLite transaction using a 20-minute lease. It extracts PDFs with the same PDF.js library used by the browser and DOCX with Mammoth. Pages/paragraphs are concatenated with two newline separators; every source segment keeps an ID, number, and absolute text range. The worker creates overlapping, word-boundary chunks with absolute source ranges and FTS5 entries, then changes the record to ready atomically. Empty extraction is an error; empty pages in a mixed PDF are a searchable-coverage warning. A deleted document cannot be reinserted by a late worker result.

## Retrieval And Chat

FTS5 searches are executed independently for each selected document, with a small fixed synonym dictionary. Ordinary chat supplies at most six passages per document; source content and old conversation entries are explicitly untrusted data, not instructions. Coverage reports count retrieved versus indexed chunks and never equate a partial search with a whole-contract review.

Gemini streams a draft containing citation placeholders. The server persists partial text during generation. A second Gemini request proposes exact quotations for the draft's placeholders. Code, not the model, finds those quotations in the right document. Final paragraphs lacking verified citations are removed. During streaming and after cancellation, draft text and placeholders are explicitly unverified. The final NDJSON event replaces the draft with the evidence-checked result.

Quote verification collapses whitespace while preserving per-normalized-character original start/end offsets. Matching is case/character-sensitive after that normalization. All exact occurrences are retained. A quotation is accepted as final evidence only if an occurrence is covered by retrieved chunk source ranges, allowing whitespace-only separators between adjacent pages. This also prevents using a genuine quotation from an unexamined section as retrieved evidence.

## Viewing

PDF pages are rendered lazily near the viewport. PDF.js provides a selectable text layer. A verified source range is converted to its normalized page position; the renderer checks that normalized page text matches extracted text before mapping that position back to text nodes. DOM ranges yield per-line highlight rectangles. Repeated quotations retain their distinct normalized positions; the evidence card lets the user choose an occurrence. Cross-page quotations produce separate highlights on each affected page. If mapping cannot be proven, no guessed highlight is drawn.

DOCX paragraphs use stable IDs and source-relative ranges. Navigation scrolls to the matching paragraph and wraps precisely the source substring in a mark, preserving repeated and multi-paragraph source positions.

## Comparison

The diff library aligns source paragraphs using exact equality, word-set similarity and numbered headings. Distinct replaced topics become removal plus addition. Numeric changes and changed obligation language in liability, fees, indemnity, termination, confidentiality and governing-law provisions are prioritized. Explanations use actual before/after wording and monetary strings, not fabricated legal reasoning. This is a deterministic review aid, not a complete legal impact model.

## Part C Option 2

Gemini receives `search_document`, `get_section`, `list_clauses`, and `get_document_coverage` function declarations and a metadata-only initial research question. It chooses tools, receives real tool outputs, and can make another decision. Prior model content, including tool-call metadata, is preserved in the next turn. Zod validates arguments and selected-document IDs. Unknown tools and malformed arguments return bounded errors. At most three research rounds and six tool executions are allowed, including invalid attempted executions. The final answer uses the ordinary streamed answer and quotation-verification pipeline. No tracked-change redlining was attempted.

## Hosting And Trust Boundary

Web and worker share one local SQLite database and file volume. This is intentionally a single-user, persistent Node architecture. Database/files never live only in process memory or ephemeral temporary storage. Gemini keys are server-only. Cross-origin browser writes are rejected. Parsed binary uploads remain a security boundary; keep the service private or harden it before inviting arbitrary public uploads.