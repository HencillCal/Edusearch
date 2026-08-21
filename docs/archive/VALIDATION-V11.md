# EduSearch AI V11 validation

## Source validation

- 85 TypeScript and TSX application files passed TypeScript syntax transpilation.
- The changed backend files (`files.ts`, `pdf-reconstruction.ts`, and `api.ts`) passed TypeScript checking with runtime dependency declarations.
- `scripts/ocr_preprocess.py` passed Python bytecode compilation.

## OCR preprocessing test

A synthetic printed examination page containing:

- Institution and examination headings
- Instructions
- Three numbered questions
- Marks
- Ruled answer space
- A three-column bordered table

was processed through the V11 OpenCV layer.

Observed diagnostics:

- Illumination normalization: applied
- Blur risk: 0%
- Contrast score: 62.27%
- Long-rule density: 1.874%
- Table-grid score: 68.87%
- Adaptive-threshold sidecar: generated
- Rule-free sidecar: generated

Tesseract recovered all headings, instructions, three questions and marks from the normalized and adaptive variants. The rule-free variant additionally recovered the table headings as plain text without grid interference.

## Environment limitation

The configured npm mirror returned HTTP 404 for `@eslint/js`, so a dependency-resolved Vite production build could not run in this workspace. Run `npm install`, `npm run check`, and a real PDF/DOCX export locally before production release.
