# Demo Script: 3-5 Minutes

Use synthetic, nonconfidential contracts. Do not record API keys, environment-file contents, or confidential files.

## Before Recording

Run the checks in the README. Enter a replacement Gemini key directly into `.env.local`, restart, and run `npm run verify:gemini`. Record only after the real provider succeeds. If the provider is blocked, state that plainly rather than show fixture responses as AI.

## Walkthrough

**0:00-0:35 - Upload and persistence**

Show the Accord workspace. Upload a PDF and a DOCX, point to actual indexing state, open the originals, and refresh to demonstrate durable storage. Upload a blank or unsupported file briefly to show the error.

**0:35-1:25 - Streamed answer and exact evidence**

Select the original contract and ask, "What is the liability cap?" Show real tokens arriving with unverified citation placeholders. Wait for verified evidence cards. Explain that the server searches the correct document and calculates source positions rather than accepting model offsets. Click a quote to highlight the source. For a repeated quote, select its second occurrence.

**1:25-1:55 - Cancellation and history**

Ask another question and stop generation while it is streaming. Show the retained, clearly unverified partial output. Open another contract and return to the first to reopen its history.

**1:55-2:30 - Multi-document question**

Select original and revised contracts. Ask for a comparison of liability obligations. Show document-labeled evidence and retrieved/total chunk counts. Emphasize that a limited search cannot establish absence of a clause.

**2:30-3:15 - Substantive comparison**

Open Compare, select the two versions, and run comparison. Demonstrate AED 100,000 -> AED 1,000,000 as High significance. Filter and sort, inspect both source paragraphs, and click to open the relevant original.

**3:15-4:15 - Part C research**

Enable Research and ask for an analysis requiring termination, notice, and liability provisions. Show actual tool events and multiple rounds where the model chooses to continue. Explain the three-round/six-call budget and argument validation. Finish by opening verified final citations.

**4:15-4:45 - Honest limitations**

Explain no OCR, lexical retrieval, heuristic alignment, conservative PDF mapping, and the need for human legal review. Show the genuine 150-page upload test result. State any live/deployment blockers still present. End on the real workspace, not a roadmap screen.

Submit an actual screen recording via Loom, an unlisted video, or a shareable drive link. This document is a script, not a completed video.