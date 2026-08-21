# EduSearch AI V10 — Mobile-scan OCR and publication reconstruction

V10 concentrates on difficult photographed pages and on producing a document that reads like an intentionally typeset academic PDF.

## OCR accuracy pipeline

1. Decode the image and apply EXIF rotation.
2. Optionally run OpenCV page-boundary detection.
3. Correct perspective when a reliable four-corner page is detected.
4. Normalize uneven illumination and page shadows.
5. Measure glare, shadow and contrast, then surface warnings in the editor.
6. Run orientation detection and fine deskewing.
7. Create clean, binary, local-contrast and soft OCR variants.
8. Run multiple Tesseract segmentation passes.
9. Reject weak passes and ensemble the reliable line readings.
10. Preserve word positions for reading order and table-cell reconstruction.
11. Optionally send only uncertain/formula-heavy line crops to a configured vision OCR model.
12. Keep alternatives and the original OCR text for human review.

The OpenCV layer is optional. Without Python/OpenCV, the backend uses the existing Sharp pipeline and records the fallback in the OCR diagnostics.

## Organised PDF reconstruction

- Exam, notes and compact layouts remain separate.
- Mathematical lines are rendered in dedicated formula panels.
- Detected answer lines are redrawn as clean writing lines.
- Table columns use content-weighted widths instead of equal widths.
- Multi-page dimensions and question numbering are normalized before export.
- Duplicate page furniture remains suppressed.
- Low-confidence content remains visibly marked as draft until reviewed.
- DOCX exports preserve formulas, answer lines and actual table cells.

## Optional vision refinement

Set an OpenAI-compatible vision endpoint:

```env
OCR_VISION_BASE_URL=http://localhost:11434/v1
OCR_VISION_MODEL=qwen2.5-vl:7b
OCR_VISION_API_KEY=
OCR_VISION_MAX_LINES=8
```

The model is not asked to rewrite the document. It receives only the highest-priority uncertain line crops and must return exact transcription. A replacement is accepted only after length, similarity and suspicious-character checks.

## OpenCV installation outside Docker

```bash
python -m pip install -r requirements-ocr.txt
```

Docker installs Debian's `python3-opencv` and `python3-numpy` packages automatically.
