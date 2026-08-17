# EduSearch AI V5 — Page-Aware Search Intelligence

## Added in this step

1. Document-section indexing
   - Published documents are split into bounded, overlapping text sections.
   - Every section stores its document, order, page number, heading and character range.
   - A dedicated SQLite FTS5 index supports fast question and phrase lookup.
   - Publishing, unpublishing, moderation and reindex operations keep document and section indexes synchronized.

2. Page-aware extraction
   - PDF text extraction preserves page boundaries.
   - Scanned-PDF OCR already emits page separators and now feeds the same section index.
   - Existing flattened documents are divided into estimated page ranges when explicit boundaries are unavailable.

3. Search inside documents
   - `/api/documents/:id/search?q=...` returns ranked sections, page numbers, headings, snippets and exact-match status.
   - Strict phrase/all-term matching runs first.
   - A synonym-expanded relaxed pass supports related wording when strict matching returns nothing.
   - Access control is checked before the section index is queried.

4. Search-result navigation
   - Global results are annotated with the strongest matching page and section.
   - Opening a result carries the query and page into the viewer.
   - The viewer displays indexed matches and jumps to the selected PDF page.

5. Live autocomplete
   - `/api/search/suggestions?q=...` combines accessible document titles, subjects, topics and safe popular searches.
   - Restricted library titles and private search phrases are not exposed to unauthorized users.
   - Autocomplete is connected to the homepage, desktop header and mobile search page.

6. Search administration
   - Administrators can rebuild the complete section index from the dashboard.
   - Dashboard search metrics show the number of indexed sections.
   - Search-index rebuilds are written to the audit log.

7. Analytics separation
   - Inside-document searches are logged for usefulness and personalization.
   - They are excluded from public popular-search lists and global missing-document reports.

## Database migration

V4 databases are upgraded in place. The migration creates `document_chunks` and `document_chunk_fts`, then indexes only published documents that are missing section records. No existing document or account rows are deleted.

## Validation performed

- 84 TypeScript/TSX application files passed syntax transpilation.
- Fresh database creation and SQLite integrity checks passed.
- V4-to-V5 in-place migration passed.
- Explicit two-page document indexing preserved page 1 and page 2 correctly.
- Exact-question search, related-wording search, page matching and direct-result navigation contracts passed API smoke tests.
- Anonymous users could not search, autocomplete or open private document sections.
- Authorized library members could use global and inside-document search on the same restricted document.
- Administrator full-index rebuild passed and retained database integrity.
