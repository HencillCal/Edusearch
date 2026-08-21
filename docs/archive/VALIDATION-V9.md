# EduSearch AI V9 validation record

Validation was performed in the build workspace on 28 July 2026.

## Source checks

- 85 TypeScript and TSX files were parsed and transpiled with TypeScript 5.8.3: 0 syntax errors.
- The complete backend (`api.ts`, `auth.ts`, `db.ts`, `files.ts`, and `pdf-reconstruction.ts`) passed strict TypeScript checking against local declarations for its external packages.
- A fresh SQLite database initialized successfully with 38 tables, 10 seeded documents and 10 indexed document chunks.
- `PRAGMA integrity_check` returned `ok`.
- `/api/health`, `/api/search`, and `/api/search/suggestions` returned HTTP 200 in the backend smoke harness.

## OCR benchmark

A generated examination page was rotated sideways, skewed by approximately 2.2 degrees and JPEG-compressed before recognition with native Tesseract 5.5.0.

Observed result:

- orientation correction: 270 degrees
- deskew correction: approximately -2.25 degrees
- OCR confidence: approximately 96.08%
- EduSearch quality score: 89/100
- accepted-pass agreement: 100%
- expected benchmark terms recovered: 17/17
- questions and subquestions detected: 6
- marks recovered: 30
- suspicious weak local-contrast pass retained in diagnostics but rejected from the accepted ensemble

A separate notes page was classified as two-column and reordered into left-column-then-right-column reading order. The test also showed that column detection does not guarantee that every faint or missed OCR line will be recovered; manual review remains required.

## Export validation boundary

The PDF and DOCX reconstruction modules and export-route wiring passed strict TypeScript checks. The smoke harness exercised health and search APIs, but did not generate real PDF or DOCX binaries. A complete dependency-resolved Vite build and real `pdf-lib`/`docx` binary generation test could not be run in this workspace because `npm install` timed out. Run `npm install && npm run check` locally before production deployment.

## Clean-package check

The distributable excludes runtime databases, OCR images, uploads, sessions, `.env`, dependency folders and build output.
