# EduSearch AI V6 — Structured OCR Reconstruction

## Added in this step

1. Structured academic-page reconstruction
   - OCR output is stored as pages containing ordered, typed blocks.
   - Supported block types: institution, title, metadata, instruction, section, question, sub-question, table, paragraph and footer.
   - Question numbers and marks are detected and stored separately from the editable text.

2. Confidence-aware correction
   - Tesseract TSV word confidence is aggregated into line and block confidence when available.
   - Every uncertain block is visibly flagged beside the enhanced source page.
   - A reviewer must verify and mark all uncertain blocks before the backend accepts publication.

3. Reconstruction editor
   - Enhanced pages and persisted source files are served through access-controlled endpoints.
   - Reviewers can edit text, change block type, correct question numbers and marks, reorder blocks, delete blocks and add missing blocks.
   - Raw-text editing remains available and is converted back into a structured document on save.

4. Revision history
   - Every save creates an immutable OCR revision with a note, editor identity and timestamp.
   - Older revisions can be restored without deleting later history; restoration creates a new revision.
   - Existing V5 OCR jobs receive an initial migrated revision automatically.

5. Layout-aware export and publishing
   - Structured blocks are serialized in page order.
   - Explicit page boundaries are preserved in generated PDF and DOCX files.
   - Published OCR documents retain structured question formatting and enter the existing moderation and FTS indexing workflows.

6. Administrator OCR operations
   - `/api/admin/ocr-jobs` lists OCR work by state and contributor.
   - The administrator dashboard includes a correction queue linking directly to the structured editor.
   - Administrator publication retains the original contributor as the document uploader and sends a publication notification.

## New or expanded API endpoints

- `GET /api/ocr/jobs`
- `GET /api/ocr/jobs/:id`
- `GET /api/ocr/jobs/:id/source`
- `GET /api/ocr/jobs/:id/pages/:page`
- `PATCH /api/ocr/jobs/:id`
- `GET /api/ocr/jobs/:id/revisions`
- `POST /api/ocr/jobs/:id/revisions/:revision/restore`
- `GET /api/ocr/jobs/:id/export?format=pdf|docx`
- `POST /api/ocr/jobs/:id/publish`
- `GET /api/admin/ocr-jobs?status=...`

## Database migration

V5 databases are upgraded in place. `ocr_jobs` receives `structure_json`, `revision` and `published_document_id`. The new `ocr_revisions` table stores immutable snapshots. Completed pre-V6 OCR jobs are inserted as migrated revision records. No account, document, library, search index or uploaded file is deleted.
