# EduSearch AI V12 — visual-layout OCR and hybrid academic PDF reconstruction

V12 addresses a failure that pure text OCR cannot solve: academic papers often contain diagrams, mathematical notation, ruled tables and answer areas whose meaning is damaged when every region is flattened into plain text.

## Final-coordinate layout analysis

OpenCV now performs a second, analysis-only pass **after** the page has completed:

- EXIF/orientation rotation
- perspective correction
- trimming
- resizing
- deskewing
- contrast normalization

This is important because crop coordinates detected before those transformations can point to the wrong area in the exported PDF. V12 records table and figure regions in the exact coordinate system used by the enhanced page shown in the editor.

## Ruled-table recovery

The page analyzer separates horizontal and vertical rules, groups connected grids, estimates row and column boundaries, and scores spacing regularity. Regularity prevents a circuit diagram or boxed illustration from being misclassified as a table.

Detected tables receive:

- source-region coordinates
- estimated rows and columns
- grid confidence
- reconstructed OCR cells when reliable
- a source-crop fallback when cell reconstruction is malformed

## Figure and diagram preservation

Sparse line drawings, charts, circuits and labelled diagrams are detected as non-text visual regions. Their source image crop is retained in the OCR structure instead of attempting to describe the drawing using unreliable OCR text alone.

Detected visuals remain reviewable. The editor exposes a caption field, the confidence score and a source-crop badge. Low-confidence candidates must be checked before final publication.

## Formula fidelity

Standalone formula blocks preserve the original notation crop in hybrid output. The OCR transcription remains searchable and editable underneath the visual notation. This avoids replacing integrals, exponents, roots or Greek symbols with misleading ASCII text in the final document.

## Three reconstruction modes

1. **Hybrid** — organised text plus original source crops for figures, formulas and uncertain tables. This is the recommended final output.
2. **Reconstruct** — text-only academic reflow, useful when every block has been verified and visuals are unnecessary.
3. **Source** — aggressively preserves source regions for maximum visual fidelity.

The same visual strategy is available for PDF and DOCX export. OCR publication uses hybrid mode automatically.

## Verified-output preflight

The preflight now checks:

- figure count
- source-preserved visual count
- missing crop coordinates
- uncaptioned figures
- malformed table structures
- unreviewed formulas and handwriting-risk blocks

A visual block marked for preservation but lacking valid source coordinates blocks verified export.

## Compatibility

No destructive database migration is needed. V12 fields are stored in the existing OCR structure and pipeline JSON. V11 jobs remain readable and can be reprocessed to receive aligned visual regions.
