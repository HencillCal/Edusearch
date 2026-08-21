# EduSearch AI V9 — OCR Ensemble Accuracy and Publication-Quality PDF Reconstruction

V9 concentrates on two goals:

1. recover cleaner text from rotated, skewed, low-contrast and multi-column academic scans;
2. convert the recovered structure into an exam-ready or notes-ready document instead of reproducing a raw OCR transcript.

## 1. Orientation-aware image preparation

The scanner now applies the following sequence:

1. EXIF orientation correction
2. white-background flattening
3. page-edge trimming
4. resolution normalization
5. dark-page polarity detection and optional inversion
6. Tesseract orientation and script detection
7. 90°, 180° or 270° correction when required
8. fine deskew estimation
9. grayscale and gamma normalization
10. denoising and sharpening

Orientation correction and deskew are reported separately in the reconstruction editor.

## 2. Confidence-filtered OCR ensemble

Accurate mode creates four recognition variants:

- clean normalized page
- Otsu binary page
- local-contrast CLAHE page
- soft-contrast page

Each variant is recognized using a profile-appropriate Tesseract page segmentation mode. A weak pass is still shown in diagnostics, but it is excluded from the text ensemble when its score or confidence falls substantially below the strongest pass. This prevents a damaged enhancement variant from injecting large amounts of false text into an otherwise accurate result.

The accepted passes are aligned by position and text similarity. Every reconstructed line can contain:

- selected text
- OCR confidence
- pass-agreement score
- up to three alternative OCR readings
- original text before conservative cleanup

Low-agreement lines are marked for manual review even when one engine reports high confidence.

## 3. Conservative academic cleanup

V9 does not run a general spell checker over academic content. That would risk changing names, formulas and technical terminology.

Automatic correction is restricted to high-confidence structural patterns, including:

- common OCR confusions in `Question`, `Section` and `Instructions`
- `rnarks` to `marks`
- `I`, `l` and `O` only where they appear inside detected numeric marks fields
- punctuation spacing
- line-end hyphen joining when the next line clearly continues the word

The editor reports how many safe corrections were applied.

## 4. Multi-column and table reconstruction

For notes and mixed-document profiles, very large horizontal gaps in Tesseract TSV output are treated as possible column boundaries. V9 then:

- separates joined left and right column text;
- detects whether the page is genuinely two-column;
- preserves full-width headings;
- orders the left column before the right column within each section;
- avoids enabling this behavior automatically for exam pages where right-aligned marks can resemble another column.

Consecutive table-like rows are grouped into one structured table block. The PDF and DOCX writers render those blocks as actual cells with a highlighted header row.

## 5. Source-layout intelligence

The structure model now records:

- block agreement
- alternative readings
- original OCR text
- inferred spacing after each block
- repeated page-furniture markers

Large vertical gaps after exam questions are converted into bounded answer space. Repeated running headers and footers detected on later pages are removed from the clean reconstruction while remaining visible in the searchable scan PDF.

## 6. Organised PDF templates

### Exam-ready PDF

- centered institution and examination title
- labelled course metadata
- boxed instructions
- section bands
- numbered questions and subquestions
- marks in right-aligned pills
- question groups kept together where possible
- answer lines inferred from source spacing
- real table cells
- OCR-review highlighting for disputed text
- running header and numbered footer

### Organised notes PDF

- academic title hierarchy
- section headings
- flowing paragraphs and bullets
- table reconstruction
- compact but readable spacing
- source pages reflowed into a clean document

### Compact PDF

- smaller typography and reduced spacing
- intended for revision packs and printing
- answer space removed

### Searchable scan PDF

The enhanced source image remains visible and receives an invisible positional OCR text layer. This is the faithful-evidence format and does not remove repeated headers or reflow the page.

## 7. Vocabulary customization

Native Tesseract can use optional course-specific vocabulary files:

```env
OCR_USER_WORDS_PATH=./data/ocr-user-words.txt
OCR_USER_PATTERNS_PATH=./data/ocr-user-patterns.txt
OCR_ENSEMBLE_SCORE_DELTA=18
```

Use one accepted term or pattern per line. Starter files are included at `config/ocr-user-words.example.txt` and `config/ocr-user-patterns.example.txt`. Copy them into `data/`, edit them for the institution or course, and point the environment variables at the copied files. This is useful for lecturer names, institution names, medical terms, engineering terminology and uncommon course vocabulary.

## 8. Compatibility

V9 does not require a new database table. New OCR details are stored inside the existing `pipeline_json` and `structure_json` columns. Older jobs are normalized with safe defaults when opened.

## 9. Validation benchmark

The included pipeline was exercised against a synthetic exam page that was:

- rotated sideways;
- skewed by approximately 2.2 degrees;
- JPEG-compressed;
- processed with all four accurate-mode variants.

Observed result in this environment:

- orientation correction: 270 degrees
- deskew correction: approximately -2.25 degrees
- accepted-pass agreement: 100%
- OCR confidence: approximately 96.08%
- quality score: 89/100
- expected benchmark terms recovered: 17/17
- questions and subquestions detected: 6
- total marks recovered: 30

A separate two-column notes test was correctly classified as `two-column` and reordered into column reading order. These figures describe the synthetic test only; real accuracy depends on focus, resolution, shadows, handwriting, language data and page damage.
