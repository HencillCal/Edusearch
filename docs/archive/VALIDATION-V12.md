# EduSearch AI V12 validation

## Source checks

- 86 TypeScript and TSX source files passed TypeScript syntax transpilation.
- Modified backend modules passed strict semantic checking with external dependency declarations.
- `scripts/ocr_preprocess.py` passed Python bytecode compilation.
- `scripts/validate_v12_layout.py` passed Python bytecode compilation.

## Layout benchmark

A synthetic engineering examination page contained:

- ordinary headings and questions
- a ruled 4 × 4 table
- a labelled electrical-circuit diagram
- formula text
- answer lines

The final-coordinate analyzer returned:

- table rows: 4
- table columns: 4
- table confidence: approximately 98%
- one separate figure region
- no table/figure overlap

A separate text-only examination page produced:

- false tables: 0
- false figures: 0

Run the reproducible check with:

```bash
npm run validate:ocr-layout
```

## Preflight regression

A reviewed structure containing a title, question, source-preserved figure and source-preserved formula passed verified-PDF preflight with a score of 100. Removing the figure source coordinates correctly produced the blocking code `missing-source-region`.

## Build limitation

The workspace npm mirror returned HTTP 404 for required packages, including `@eslint/js` and `@hookform/resolvers`. A dependency-resolved Vite build and binary PDF/DOCX generation therefore require `npm install` on a normal npm connection. The Python layout benchmark, source transpilation, backend semantic checks and preflight regression passed.
