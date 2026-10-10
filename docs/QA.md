# QA Results

Checked locally on 2026-10-10. These results are evidence for the tested cases, not a guarantee for every contract or PDF layout.

## Passing Checks

- 40 backend tests and 13 Playwright browser tests passed after Groq integration; lint and production build also pass.
- Dense, actual 150-page and 200-page generated PDFs upload, index, render, and highlight final-page quotations. Files are saved under `data/qa-fixtures/` and are synthetic, nonconfidential examples.
- The 150-page original contains 508,208 extracted characters. The 200-page original contains 678,958; its revised version contains 678,960.
- Exact final-page highlights stay in view through zoom, page-number fields display three digits, and off-screen canvases are released.
- Comparison finds the liability-cap change on page 199. Written duration changes and added exceptions are substantive; simple clause renumbering is not treated as a changed monetary limit.
- Landscape, rotated, separate-column, mixed-font, and multiline PDF citation cases pass. Repeated and cross-page source quotations also pass.
- Invalid uploads, unreadable PDFs, mixed blank/text warnings, malformed chat requests, cross-origin writes, exact original downloads, deletion, persistence, and bounded worker recovery pass.
- Exact quotes are verified against their own source document and retrieved evidence. Fabrication, paraphrase, malformed citation data, and out-of-retrieval quotations are rejected.
- The actual Gemini SDK, with a synthetic HTTP transport, retries HTTP 503 within a two-attempt cap and does not retry HTTP 429. These transport checks do not consume provider quota.

## Fixes

- Replaced repeated growing-string normalization with linear accumulation; dense-source answer tests that previously took 34-55 seconds now pass within the existing five-second test timeout.
- Expanded comparison coverage from 1,800 to 12,000 paragraphs per version, with an alignment timeout and truthful coverage reporting.
- Fixed same-timestamp history ordering, off-screen canvas retention, zoom citation displacement, clipped page numbers, and misleading generic provider errors.
- Removed the key from the shareable environment template; the local key remains untouched.

## Real Gemini Evidence And Blocker

Groq is now selectable with `AI_PROVIDER=groq`. Its adapter tests cover streaming, cancellation forwarding, JSON citation output, malformed tool calls, and ordinary/research answers through the real local verification pipeline using synthetic provider responses. Browser tests pass with Groq selected and no key configured. The exposed key supplied in chat was not used or saved; a replacement must be entered privately in `.env.local`. Live Groq ordinary/research and 150/200-page AI verification remains pending. Use `npm run verify:ai -- --large` after entering the replacement and restarting.

Earlier real-provider runs completed ordinary chat, a two-document comparison with citations from both sources, and research with two model rounds/two tool calls. A real final-page answer on the dense 150-page source returned one verified citation in about 30 seconds.

The latest large-file live run fails with HTTP 429 during answer generation. Upload/indexing succeeds for all three fixtures. Full live 200-page ordinary chat, research, and cross-version answer verification remains blocked; mocked 150/200-page answer tests are not a substitute for that evidence.

Quota must be restored in the provider project by waiting for the relevant reset, enabling billing, or obtaining a quota increase. No fallback answer is fabricated, and failed partial text is retained as unverified. Run `npm run verify:gemini -- --large` after quota is available.

## Remaining Boundaries

No OCR is implemented. Complex tables, reordered clauses, extraction character changes, and layouts beyond the tested examples can require manual review. Exact quotation existence is not proof of legal interpretation or entailment. The PDF viewer refuses ambiguous mapping rather than drawing an inaccurate highlight. Comparison remains deterministic assistance, not a complete legal change classifier.

Deployment, Docker runtime behavior, a public repository, and the recorded demo are separate submission requirements and are not certified by this local QA run.