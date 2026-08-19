# EduSearch AI — Real Backend Edition

EduSearch AI is a full-stack academic document search and OCR application. The existing TanStack Start interface is connected to a persistent Node backend instead of static demo actions.

## Version 13 production administration upgrade

V13 completes the operational workflows needed to manage the application instead of leaving administrative controls as display-only elements.

- Create, edit, promote, demote and delete users or administrators
- Prevent self-deletion, self-demotion and removal of the last administrator
- Transfer owned libraries safely when an account is deleted
- Create, open, rename and delete personal collections; remove their documents in place
- Edit, publish, archive and permanently delete documents from the admin dashboard
- Create, edit and delete subjects and topics with linked-document safeguards
- Edit or delete institution libraries, rotate codes, control visibility, membership and documents
- Review and resolve contact messages from the administrator dashboard
- Includes a current npm lockfile, clean TypeScript check, production build and live API verification

See `UPGRADE-V13.md` and `VALIDATION-V13.md`. V12 visual-layout OCR and all earlier capabilities remain included.

## Version 12 visual-layout OCR and hybrid-PDF upgrade

V12 preserves academic meaning that text-only OCR can destroy. It detects ruled tables and non-text diagrams in final enhanced-page coordinates, keeps source crops for formulas and figures, and produces a hybrid PDF that combines organised editable text with the original visual evidence.

- Detects regular table grids and estimates row/column boundaries
- Separates diagrams and line drawings from ruled tables
- Re-analyzes layout after rotation, deskewing, trimming and resizing so crops stay aligned
- Preserves figure, formula and uncertain-table crops in PDF and DOCX
- Adds Hybrid, Text-only Reflow and Source-faithful export modes
- Adds figure captions and source-preservation indicators to the editor
- Blocks verified export when a preserved visual has no valid source coordinates
- Includes a reproducible OpenCV layout validation script

See `UPGRADE-V12.md` and `VALIDATION-V12.md`. All V11 verified-export controls and earlier search, OCR, compliance and private-library capabilities remain included.

## Implemented backend

- Persistent SQLite database with WAL mode, foreign keys and automatic schema creation
- Full-text document and page-section indexes using SQLite FTS5
- Exact-question and related-wording search inside documents with page-aware matches
- Live search autocomplete with private-library filtering
- Synonym expansion, spelling correction, fuzzy suggestions and missing-search analytics
- Registration, login, HttpOnly database-backed sessions and role-based administration
- PDF, DOCX, image, multi-file and ZIP upload staging
- SHA-256 duplicate detection and optional ClamAV virus scanning
- PDF/DOCX text extraction with digital-text-first PDF analysis and automatic scanned-page fallback
- High-accuracy OCR using EXIF rotation, optional OpenCV page/perspective correction, deskew, trim, upscale, grayscale, gamma, contrast, adaptive/Otsu thresholding, sharpen, denoise and multi-pass candidate selection
- Durable background OCR jobs with explicit upload, preprocessing, OCR, layout, reconstruction, review, verification, failure and publication stages; failures retain diagnostics instead of returning placeholder text
- Tesseract word/line geometry persisted in dedicated OCR page, word, line and block tables for columns, marks, hierarchy, tables, formulas and visual crops
- Automatic exam/notes/assignment/marking-scheme document classification with exam hierarchy, wrapped-line joining, question-number, subquestion, mark-total and inconsistency detection
- Exam, notes, table and mixed-document OCR profiles with fast, balanced and accurate modes
- Structured page-by-page OCR reconstruction, typed academic blocks, confidence review, version history and clean/searchable PDF plus DOCX generation
- Server-side preflight gates verified PDF/DOCX export and publication; OCR drafts are visibly marked `OCR DRAFT — REVIEW REQUIRED`
- Document moderation states: draft, awaiting review, published, rejected, changes requested and archived
- Real preview, download, view and download counters
- Saved documents, starter collections and contributor upload history APIs
- Followed topics, personalized recommendations and notifications
- User ratings, quality reports and a formal copyright/takedown case workflow
- Admin metrics, pending uploads, OCR correction queue, OCR workload and no-result search reports
- Admin report moderation, copyright request review and internal subject/topic management
- Complete user and administrator lifecycle management with last-admin protection
- Full collection, taxonomy, document, library and contact-message administration
- Public/private institution libraries with role-based membership and hashed join codes
- Library-targeted uploads and access-controlled academic documents
- Administrator audit-log API and library metrics
- Optional OpenAI-compatible metadata classification and embedding-based semantic search with deterministic fallback
- Same-origin mutation checks, upload limits, rate limiting, private compliance evidence storage and security headers

## Requirements

- Node.js 22.13 or later
- npm
- Poppler (`pdftoppm`) only when scanning image-only PDF files locally. Docker includes it automatically.

## Local start

### Windows one-command start

Double-click `START-EDUSEARCH.bat`, or run:

```powershell
.\START-EDUSEARCH.ps1
```

### Manual start

```bash
npm install
npm run setup
npm run dev
```

Open the URL printed by Vite. The SQLite database and uploaded files are created under `data/`.

The first registered user becomes an administrator by default. Set `FIRST_USER_ADMIN=false` to disable that behavior.

## Production build

```bash
npm run build
npm start
```

The production start script loads `.env`, starts `.output/server/index.mjs`, and serves both the TanStack application and `/api` endpoints.

## Docker start

```bash
npm run dev:docker
```

This starts the application and ClamAV. Uploaded files and the SQLite database persist in `./data`.

## Optional AI metadata provider

The upload and OCR pipelines always work using deterministic extraction. To enable an OpenAI-compatible classifier, copy `.env.example` to `.env` and configure:

```env
AI_BASE_URL=http://localhost:11434/v1
AI_CHAT_MODEL=qwen2.5:7b-instruct
AI_EMBEDDING_MODEL=nomic-embed-text
AI_API_KEY=
```

The provider must expose an OpenAI-compatible `/chat/completions` endpoint. The backend falls back safely when the provider is unavailable.

## Main API groups

- `/api/search`, `/api/search/suggestions`, `/api/home`, `/api/subjects`, `/api/contact`
- `/api/copyright-requests`, `/api/copyright-requests/status`
- `/api/documents/:id`, `/search`, `/preview`, `/download`, `/save`
- `/api/documents/:id/rating`, `/report`
- `/api/auth/register`, `/login`, `/logout`, `/me`
- `/api/uploads/analyze`, `/submit`, `/mine`
- `/api/ocr/jobs`, `/reprocess`, `/pages/:page`, `/source`, `/revisions`, `/restore`, `/preflight`, `/export`, `/publish`
- `/api/admin/dashboard`, `/documents`, `/ocr-jobs`, `/missing-searches`
- `/api/recommendations`, `/followed-topics`, `/notifications`
- `/api/libraries`, `/api/libraries/join`, `/api/libraries/:id`, `/documents`, `/members`
- `/api/admin/reports`, `/copyright-requests`, `/taxonomy`, `/subjects`, `/topics`, `/audit`, `/search/reindex`

## Upgrade compatibility

Existing V10 and V11 SQLite databases remain compatible. V12 stores aligned visual regions, captions and source-preservation instructions inside the existing OCR pipeline and structure JSON fields, so no destructive database migration is required. Existing OCR jobs receive safe legacy defaults and can be reprocessed for visual-region detection.

## Storage and scaling

SQLite WAL is appropriate for a single application instance and moderate traffic. For horizontal multi-instance deployment, replace the repository layer with PostgreSQL and move uploaded files to S3-compatible object storage. The HTTP API and frontend contracts can remain unchanged.

## Dependency lock note

The original Bun lockfile was removed after the dependency graph changed. Run `npm install` once to create a current `package-lock.json`, then commit that lockfile before a production release.

## V10 OCR accuracy setup

For photographed papers, install the optional OpenCV preprocessing layer:

```bash
python -m pip install -r requirements-ocr.txt
```

It corrects page perspective and uneven lighting before OCR. Docker includes this layer automatically. A configured OpenAI-compatible vision model can selectively re-read uncertain lines; it is never required for normal operation. See `UPGRADE-V10.md`.
