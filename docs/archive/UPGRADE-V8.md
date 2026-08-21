# EduSearch AI V8 — High-Accuracy OCR and Organised PDF Reconstruction

V8 focuses on the two outcomes that determine whether OCR is genuinely useful for academic documents:

1. recovering the text as accurately as possible from photographs and scanned PDFs;
2. converting that text into a clean, editable and well-organised academic document rather than dumping raw OCR lines into a PDF.

## Accuracy pipeline

The OCR service now uses a staged pipeline instead of one fixed Tesseract pass.

- Reads an existing PDF text layer first and keeps it when the extracted text is sufficiently complete.
- Applies EXIF rotation, page trimming, resolution normalisation, grayscale conversion, gamma correction, contrast normalisation, sharpening and optional denoising.
- Estimates page skew using horizontal text projection and rotates the page back before recognition.
- Builds clean, binary and soft-contrast image variants.
- Runs several page-segmentation strategies chosen for exam papers, notes, tables or mixed pages.
- Uses native Tesseract when installed and falls back to Tesseract.js when necessary.
- Scores every OCR candidate using confidence, readable-word coverage, suspicious-character penalties, line consistency and document structure.
- Selects the strongest candidate automatically and records the selected engine, pass, skew correction and processing report.
- Preserves deliberate wide spaces from TSV output so tabular rows can be reconstructed more reliably.
- Applies conservative cleanup only; it does not silently rewrite academic wording.

OCR can be rerun from the reconstruction editor with a different profile, quality mode or language combination. Every rerun creates a new revision.

## OCR modes

- **Accurate** — most preprocessing variants and recognition passes; intended for final scans.
- **Balanced** — fewer passes with good quality for ordinary documents.
- **Fast** — minimal processing for quick previews.

## Document profiles

- **Exam** — prioritises question numbers, subquestions, instructions and marks.
- **Notes** — prioritises headings and flowing paragraphs.
- **Table** — prioritises spacing and grid-like content.
- **Mixed** — handles pages containing several layout styles.

The language field accepts Tesseract language codes such as `eng` or combined codes such as `eng+swa`, provided the corresponding language data is installed.

## Organised PDF outputs

V8 creates two separate PDF formats because a clean reconstructed document and a faithful searchable scan solve different problems.

### Clean organised PDF

- A4 academic layout
- centred institution and document title
- labelled metadata rows
- highlighted section headers
- boxed instructions
- numbered questions and subquestions
- marks aligned at the right margin
- reconstructed table cells
- readable paragraph spacing
- running header and page numbers
- source-page boundaries preserved

### Searchable enhanced scan PDF

- places each enhanced scan as the visible PDF page;
- overlays an invisible text layer using OCR block coordinates;
- preserves the visual evidence of the original paper;
- allows text search and selection in compatible PDF viewers.

A structured DOCX export remains available for further editing.

## Quality and review

The editor displays both:

- **OCR confidence**, reported by the OCR engine; and
- a **quality score out of 100**, calculated by EduSearch AI from confidence, text coverage, suspicious characters and recovered structure.

The quality score is a comparison heuristic, not a guaranteed percentage of correctly recognised characters. Low-confidence blocks remain highlighted and must be reviewed before publication.

## Runtime requirements

Docker installs Poppler, native Tesseract, English language data and Swahili language data. Local installations can use Tesseract.js automatically, but native Tesseract is recommended for accurate mode and multi-language recognition.

Relevant environment variables:

```env
OCR_LANGUAGE=eng+swa
OCR_DEFAULT_PROFILE=exam
OCR_DEFAULT_QUALITY_MODE=accurate
OCR_MAX_PAGES=40
OCR_PAGE_TIMEOUT_MS=180000
OCR_FORCE_IMAGE=false
```

## Database migration

V7 databases are upgraded in place with:

- `ocr_jobs.quality_score`
- `ocr_jobs.ocr_profile`
- `ocr_jobs.ocr_language`
- `ocr_jobs.ocr_quality_mode`
- `ocr_jobs.pipeline_json`

Existing OCR jobs, revisions, documents, rights cases, libraries and search indexes are preserved.
