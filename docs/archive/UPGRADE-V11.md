# EduSearch AI V11 — OCR accuracy and verified PDF preflight

V11 concentrates on recognition failure modes that remain after perspective correction: uneven lighting, long ruled answer lines, table borders, blur, degraded print and handwriting-like strokes.

## New OCR image variants

For accurate OCR mode, OpenCV now produces two sidecar images in addition to the normalized page:

1. **Adaptive threshold** — improves foreground separation where one side of a photographed page is darker.
2. **Rule-free image** — detects and removes long horizontal and vertical rules before OCR. This prevents answer lines and table grids from being read as punctuation or merged into words.

Both images are aligned using the same orientation and deskew corrections as the clean OCR page. They join the confidence-filtered OCR ensemble; weak variants are still rejected.

The clean enhanced page remains the visual source of truth. Rule removal is used only for recognition. Tables and answer space are reconstructed from structured blocks in PDF/DOCX output.

## New scan diagnostics

The OCR pipeline now reports:

- Blur risk
- Conservative handwriting-review risk
- Table-grid score
- Long-rule pixel density
- Export-readiness score

The handwriting value is not a handwriting recognizer and is never treated as a transcript. It is a risk signal based on irregular connected components and weak baseline alignment. Suspected blocks are marked for manual verification.

## PDF reconstruction preflight

`GET /api/ocr/jobs/:id/preflight` checks the saved reconstruction for:

- Unreviewed low-confidence OCR
- Possible handwriting or severely degraded text
- Unverified mathematical notation
- Malformed or inconsistent tables
- Duplicate or missing main question numbers
- Empty source pages
- Missing document title
- Missing institution metadata as a non-blocking warning

The editor displays a score and exact page-level findings.

## Draft versus verified output

Draft exports remain available throughout correction and retain OCR-review highlighting where appropriate.

A verified final PDF uses:

```text
/api/ocr/jobs/:id/export?format=pdf&layout=clean&template=exam&final=1
```

The backend refuses this export when critical preflight findings remain. It also blocks OCR publication until the saved reconstruction passes the same preflight. It does not trust a client-side disabled button. Draft files and verified files also use different filenames.

## Compatibility

No database migration is required. New fields are stored in existing JSON columns. Existing V10 jobs open with safe defaults and can be reprocessed to receive the new diagnostics and OCR variants.
