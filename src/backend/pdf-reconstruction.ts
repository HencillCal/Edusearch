import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { OcrBlock, OcrStructure } from "./files";

export type ReconstructionMetadata = Record<string, unknown>;
export type PdfTemplate = "auto" | "exam" | "notes" | "compact";
export type PdfVisualMode = "hybrid" | "reconstruct" | "source";
export type PdfReconstructionOptions = {
  template?: PdfTemplate;
  preserveSourcePages?: boolean;
  preserveAnswerSpace?: boolean;
  showReviewHighlights?: boolean;
  sourceImagePaths?: string[];
  visualMode?: PdfVisualMode;
  draft?: boolean;
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const FOOTER_HEIGHT = 30;

type FontSet = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
};

export async function createStructuredPdf(
  title: string,
  structure: OcrStructure,
  metadata: ReconstructionMetadata = {},
  requested: PdfReconstructionOptions = {},
) {
  const template = resolveTemplate(structure, requested.template);
  const options = {
    template,
    preserveSourcePages: requested.preserveSourcePages === true,
    preserveAnswerSpace: requested.preserveAnswerSpace !== false && template === "exam",
    showReviewHighlights: requested.showReviewHighlights !== false,
    sourceImagePaths: requested.sourceImagePaths || [],
    visualMode: requested.visualMode || "hybrid",
  };
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("EduSearch AI");
  pdf.setSubject(`OCR reconstructed academic document · ${template} layout`);
  pdf.setCreator("EduSearch AI");
  pdf.setKeywords(["OCR", "academic document", "EduSearch AI", template]);

  const fonts: FontSet = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    sansBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
    monoBold: await pdf.embedFont(StandardFonts.CourierBold),
  };

  const hasUnreviewedBlocks =
    requested.draft === true ||
    structure.pages.some((sourcePage) =>
      sourcePage.blocks.some(
        (block) =>
          (block.needsReview || block.confidence < 70 || (block.agreement ?? 1) < 0.58) &&
          !block.reviewed,
      ),
    );
  let page: PDFPage;
  let cursorY = 0;
  let sourcePageNumber = 1;

  const addPage = (sourcePage = sourcePageNumber) => {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    sourcePageNumber = sourcePage;
    cursorY = A4_HEIGHT - MARGIN - 18;
    drawRunningHeader(
      page,
      title,
      options.preserveSourcePages ? sourcePageNumber : undefined,
      fonts.sans,
      fonts.sansBold,
      hasUnreviewedBlocks,
    );
    if (hasUnreviewedBlocks) cursorY -= 14;
  };

  const ensureSpace = (height: number, sourcePage = sourcePageNumber) => {
    if (cursorY - height < MARGIN + FOOTER_HEIGHT) addPage(sourcePage);
  };

  const reviewHighlight = (block: OcrBlock, height: number) => {
    if (
      !options.showReviewHighlights ||
      block.reviewed ||
      (!block.needsReview && block.confidence >= 70 && (block.agreement ?? 1) >= 0.58)
    )
      return;
    page.drawRectangle({
      x: MARGIN - 5,
      y: cursorY - height + 3,
      width: A4_WIDTH - MARGIN * 2 + 10,
      height: Math.max(14, height),
      color: rgb(1, 0.97, 0.78),
      borderColor: rgb(0.82, 0.52, 0.1),
      borderWidth: 0.45,
      opacity: 0.55,
    });
    page.drawText("OCR REVIEW", {
      x: A4_WIDTH - MARGIN - 48,
      y: cursorY - 7,
      size: 5.8,
      font: fonts.sansBold,
      color: rgb(0.62, 0.3, 0.02),
    });
  };

  const applySourceSpacing = (block: OcrBlock) => {
    if (!block.spacingAfter || block.spacingAfter < 5) return;
    const maximum = options.template === "compact" ? 10 : options.preserveAnswerSpace ? 64 : 24;
    const spacing = Math.min(maximum, block.spacingAfter);
    ensureSpace(spacing + 4);
    if (
      options.preserveAnswerSpace &&
      (block.type === "question" || block.type === "subquestion") &&
      spacing >= 20
    ) {
      const lineCount = Math.max(1, Math.min(4, Math.floor(spacing / 15)));
      for (let index = 0; index < lineCount; index += 1) {
        const y = cursorY - 8 - index * 14;
        page.drawLine({
          start: { x: MARGIN + (block.type === "subquestion" ? 28 : 0), y },
          end: { x: A4_WIDTH - MARGIN, y },
          thickness: 0.35,
          color: rgb(0.78, 0.8, 0.83),
          dashArray: [1.5, 2.2],
        });
      }
    }
    cursorY -= spacing;
  };

  const renderBlock = async (block: OcrBlock) => {
    const text = block.text.trim();
    if (!text || block.type === "footer" || block.repeated) return;

    const visualResult = await renderSourceVisualBlock({
      pdf,
      getPage: () => page,
      block,
      sourceImagePaths: options.sourceImagePaths,
      visualMode: options.visualMode,
      fonts,
      cursorY,
      ensureSpace: (height) => ensureSpace(height, block.page),
    });
    if (visualResult) {
      cursorY = visualResult.cursorY;
      if (visualResult.consumed) {
        applySourceSpacing(block);
        return;
      }
    }

    if (block.type === "institution") {
      const lines = wrap(text, fonts.sansBold, 11.5, A4_WIDTH - MARGIN * 2);
      const height = lines.length * 15 + 9;
      ensureSpace(height);
      reviewHighlight(block, height);
      cursorY -= 3;
      for (const line of lines) {
        const printable = safe(line);
        const width = fonts.sansBold.widthOfTextAtSize(printable, 11.5);
        page.drawText(printable, {
          x: Math.max(MARGIN, (A4_WIDTH - width) / 2),
          y: cursorY,
          size: 11.5,
          font: fonts.sansBold,
          color: rgb(0.12, 0.15, 0.2),
        });
        cursorY -= 15;
      }
      cursorY -= 6;
      applySourceSpacing(block);
      return;
    }

    if (block.type === "title") {
      const titleSize = options.template === "compact" ? 14 : 16;
      const lines = wrap(text, fonts.bold, titleSize, A4_WIDTH - MARGIN * 2 - 20);
      const height = lines.length * (titleSize + 4) + 14;
      ensureSpace(height);
      reviewHighlight(block, height);
      for (const line of lines) {
        const printable = safe(line);
        const width = fonts.bold.widthOfTextAtSize(printable, titleSize);
        page.drawText(printable, {
          x: Math.max(MARGIN, (A4_WIDTH - width) / 2),
          y: cursorY,
          size: titleSize,
          font: fonts.bold,
          color: rgb(0.05, 0.08, 0.13),
        });
        cursorY -= titleSize + 4;
      }
      page.drawLine({
        start: { x: MARGIN + 65, y: cursorY + 2 },
        end: { x: A4_WIDTH - MARGIN - 65, y: cursorY + 2 },
        thickness: 0.8,
        color: rgb(0.62, 0.66, 0.72),
      });
      cursorY -= 12;
      applySourceSpacing(block);
      return;
    }

    if (block.type === "metadata") {
      const match = text.match(/^([^:.-]{2,45})\s*[:.-]\s*(.+)$/);
      const label = match?.[1]?.trim();
      const value = match?.[2]?.trim() || text;
      const labelWidth = label
        ? Math.min(135, fonts.sansBold.widthOfTextAtSize(safe(label), 9.5) + 12)
        : 0;
      const lines = wrap(value, fonts.sans, 9.5, A4_WIDTH - MARGIN * 2 - labelWidth);
      const height = Math.max(15, lines.length * 13) + 2;
      ensureSpace(height);
      reviewHighlight(block, height);
      if (label)
        page.drawText(`${safe(label)}:`, {
          x: MARGIN,
          y: cursorY,
          size: 9.5,
          font: fonts.sansBold,
          color: rgb(0.2, 0.23, 0.28),
        });
      for (const [index, line] of lines.entries()) {
        page.drawText(safe(line), {
          x: MARGIN + labelWidth,
          y: cursorY - index * 13,
          size: 9.5,
          font: fonts.sans,
          color: rgb(0.12, 0.15, 0.2),
        });
      }
      cursorY -= height;
      applySourceSpacing(block);
      return;
    }

    if (block.type === "section") {
      const lines = wrap(text.toUpperCase(), fonts.sansBold, 11, A4_WIDTH - MARGIN * 2 - 20);
      const height = lines.length * 15 + 16;
      ensureSpace(height);
      reviewHighlight(block, height);
      page.drawRectangle({
        x: MARGIN,
        y: cursorY - height + 7,
        width: A4_WIDTH - MARGIN * 2,
        height: height - 2,
        color: rgb(0.91, 0.93, 0.96),
        borderColor: rgb(0.62, 0.68, 0.76),
        borderWidth: 0.7,
      });
      let y = cursorY - 6;
      for (const line of lines) {
        page.drawText(safe(line), {
          x: MARGIN + 10,
          y,
          size: 11,
          font: fonts.sansBold,
          color: rgb(0.08, 0.12, 0.18),
        });
        y -= 15;
      }
      cursorY -= height + 5;
      applySourceSpacing(block);
      return;
    }

    if (block.type === "instruction") {
      const lines = wrap(text, fonts.italic, 10.5, A4_WIDTH - MARGIN * 2 - 24);
      const height = lines.length * 14 + 20;
      ensureSpace(height);
      reviewHighlight(block, height);
      page.drawRectangle({
        x: MARGIN,
        y: cursorY - height + 6,
        width: A4_WIDTH - MARGIN * 2,
        height,
        color: rgb(0.97, 0.97, 0.94),
        borderColor: rgb(0.74, 0.72, 0.59),
        borderWidth: 0.6,
      });
      let y = cursorY - 7;
      for (const line of lines) {
        page.drawText(safe(line), {
          x: MARGIN + 12,
          y,
          size: 10.5,
          font: fonts.italic,
          color: rgb(0.18, 0.18, 0.14),
        });
        y -= 14;
      }
      cursorY -= height + 7;
      applySourceSpacing(block);
      return;
    }

    if (block.answerLines && /^(?:[_ .-]{5,})$/.test(text)) {
      const lineCount = Math.max(1, Math.min(12, block.answerLines));
      const height = lineCount * 18 + 5;
      ensureSpace(height);
      reviewHighlight(block, height);
      for (let index = 0; index < lineCount; index += 1) {
        const y = cursorY - index * 18;
        page.drawLine({
          start: { x: MARGIN, y },
          end: { x: A4_WIDTH - MARGIN, y },
          thickness: 0.45,
          color: rgb(0.55, 0.58, 0.62),
        });
      }
      cursorY -= height;
      return;
    }

    if (block.mathDetected && (block.type === "paragraph" || block.type === "formula")) {
      const lines = wrap(text, fonts.mono, 9.6, A4_WIDTH - MARGIN * 2 - 24);
      const height = lines.length * 14 + 18;
      ensureSpace(height);
      reviewHighlight(block, height);
      page.drawRectangle({
        x: MARGIN,
        y: cursorY - height + 7,
        width: A4_WIDTH - MARGIN * 2,
        height,
        color: rgb(0.965, 0.972, 0.985),
        borderColor: rgb(0.68, 0.72, 0.8),
        borderWidth: 0.55,
      });
      let y = cursorY - 6;
      for (const line of lines) {
        page.drawText(safe(line), {
          x: MARGIN + 12,
          y,
          size: 9.6,
          font: fonts.mono,
          color: rgb(0.09, 0.12, 0.2),
        });
        y -= 14;
      }
      cursorY -= height + 5;
      applySourceSpacing(block);
      return;
    }

    if (block.type === "question" || block.type === "subquestion") {
      const indent = block.type === "subquestion" ? 24 : 0;
      const number = formatQuestionNumber(block);
      const questionText = stripMarksFromText(text, block.marks);
      const marks = block.marks != null ? `${block.marks} mark${block.marks === 1 ? "" : "s"}` : "";
      const numberWidth = number
        ? Math.max(22, fonts.bold.widthOfTextAtSize(safe(number), 11) + 7)
        : 0;
      const marksWidth = marks ? fonts.sansBold.widthOfTextAtSize(marks, 8.5) + 18 : 0;
      const textWidth = A4_WIDTH - MARGIN * 2 - indent - numberWidth - marksWidth;
      const lines = wrap(questionText, fonts.regular, 11, textWidth);
      const height = Math.max(17, lines.length * 15) + 8;
      ensureSpace(height);
      reviewHighlight(block, height);
      const baseX = MARGIN + indent;
      if (number)
        page.drawText(safe(number), {
          x: baseX,
          y: cursorY,
          size: 11,
          font: fonts.bold,
          color: rgb(0.06, 0.08, 0.12),
        });
      let y = cursorY;
      for (const line of lines) {
        page.drawText(safe(line), {
          x: baseX + numberWidth,
          y,
          size: 11,
          font: fonts.regular,
          color: rgb(0.08, 0.1, 0.14),
        });
        y -= 15;
      }
      if (marks) {
        const pillX = A4_WIDTH - MARGIN - marksWidth + 6;
        page.drawRectangle({
          x: pillX,
          y: cursorY - 3,
          width: marksWidth - 6,
          height: 13,
          color: rgb(0.93, 0.94, 0.96),
          borderColor: rgb(0.7, 0.73, 0.78),
          borderWidth: 0.4,
        });
        page.drawText(marks, {
          x: pillX + 5,
          y: cursorY,
          size: 8.5,
          font: fonts.sansBold,
          color: rgb(0.25, 0.28, 0.34),
        });
      }
      cursorY -= height;
      applySourceSpacing(block);
      return;
    }

    if (block.type === "table") {
      const rows = block.tableRows?.length ? block.tableRows : parseTableRows(text);
      if (rows.length && rows.some((row) => row.length > 1)) {
        const columns = Math.min(8, Math.max(...rows.map((row) => row.length)));
        const columnWidths = calculateTableColumnWidths(rows, A4_WIDTH - MARGIN * 2, columns);
        for (const [rowIndex, row] of rows.entries()) {
          const cellLines = Array.from({ length: columns }, (_, index) =>
            wrap(
              row[index] || "",
              rowIndex === 0 ? fonts.sansBold : fonts.sans,
              8.8,
              columnWidths[index] - 10,
            ),
          );
          const rowHeight = Math.max(
            22,
            Math.max(...cellLines.map((lines) => lines.length)) * 12 + 8,
          );
          ensureSpace(rowHeight);
          if (rowIndex === 0)
            page.drawRectangle({
              x: MARGIN,
              y: cursorY - rowHeight + 5,
              width: A4_WIDTH - MARGIN * 2,
              height: rowHeight,
              color: rgb(0.92, 0.94, 0.97),
            });
          reviewHighlight(block, rowHeight);
          for (let column = 0; column < columns; column += 1) {
            const x = MARGIN + columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0);
            page.drawRectangle({
              x,
              y: cursorY - rowHeight + 5,
              width: columnWidths[column],
              height: rowHeight,
              borderColor: rgb(0.55, 0.59, 0.65),
              borderWidth: 0.5,
            });
            let cellY = cursorY - 8;
            for (const line of cellLines[column]) {
              page.drawText(safe(line), {
                x: x + 5,
                y: cellY,
                size: 8.8,
                font: rowIndex === 0 ? fonts.sansBold : fonts.sans,
                color: rgb(0.12, 0.14, 0.18),
              });
              cellY -= 12;
            }
          }
          cursorY -= rowHeight;
        }
        cursorY -= 7;
        applySourceSpacing(block);
        return;
      }
    }

    const isBullet = /^[-*•]\s+/.test(text);
    const cleanText = isBullet ? text.replace(/^[-*•]\s+/, "") : text;
    const indent = isBullet ? 18 : 0;
    const lines = wrap(
      cleanText,
      fonts.regular,
      options.template === "compact" ? 10.2 : 10.8,
      A4_WIDTH - MARGIN * 2 - indent,
    );
    const lineHeight = options.template === "compact" ? 13.2 : 15;
    const height = lines.length * lineHeight + 7;
    ensureSpace(height);
    reviewHighlight(block, height);
    if (isBullet)
      page.drawText("•", {
        x: MARGIN + 3,
        y: cursorY,
        size: 10.8,
        font: fonts.bold,
        color: rgb(0.09, 0.11, 0.15),
      });
    let y = cursorY;
    for (const line of lines) {
      page.drawText(safe(line), {
        x: MARGIN + indent,
        y,
        size: options.template === "compact" ? 10.2 : 10.8,
        font: fonts.regular,
        color: rgb(0.09, 0.11, 0.15),
      });
      y -= lineHeight;
    }
    cursorY -= height;
    applySourceSpacing(block);
  };

  addPage(1);
  const sortedPages = [...structure.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );
  for (const [pageIndex, sourcePage] of sortedPages.entries()) {
    if (pageIndex > 0 && options.preserveSourcePages) addPage(sourcePage.pageNumber);
    sourcePageNumber = sourcePage.pageNumber;
    const blocks = [...sourcePage.blocks]
      .sort((left, right) => left.order - right.order)
      .filter((block) => !block.repeated);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.type === "question") {
        const group = [block];
        for (let next = index + 1; next < blocks.length; next += 1) {
          if (["question", "section", "title"].includes(blocks[next].type)) break;
          group.push(blocks[next]);
          if (group.length >= 6) break;
        }
        const groupHeight = Math.min(
          245,
          group.reduce((sum, item) => sum + estimateBlockHeight(item, fonts, options.template), 0),
        );
        ensureSpace(groupHeight, sourcePage.pageNumber);
      }
      await renderBlock(block);
    }
  }

  if (!sortedPages.length) {
    const fallback = String(metadata.description || "No reconstructed content was available.");
    await renderBlock({
      id: "fallback",
      page: 1,
      order: 0,
      type: "paragraph",
      text: fallback,
      confidence: 100,
      needsReview: false,
      reviewed: true,
    });
  }

  const pages = pdf.getPages();
  pages.forEach((current: PDFPage, index: number) =>
    drawFooter(current, index + 1, pages.length, fonts.sans, template),
  );
  return Buffer.from(await pdf.save());
}

type VisualRenderRequest = {
  pdf: PDFDocument;
  getPage: () => PDFPage;
  block: OcrBlock;
  sourceImagePaths: string[];
  visualMode: PdfVisualMode;
  fonts: FontSet;
  cursorY: number;
  ensureSpace: (height: number) => void;
};

async function renderSourceVisualBlock(
  request: VisualRenderRequest,
): Promise<{ cursorY: number; consumed: boolean } | null> {
  const { block, visualMode } = request;
  if (block.text && block.text.trim().length >= 10 && block.type !== "figure") return null;
  const region = block.sourceRegion || block.bbox;
  const sourcePath = request.sourceImagePaths[Math.max(0, block.page - 1)];
  if (!sourcePath || !region || visualMode === "reconstruct") return null;

  const rows =
    block.type === "table"
      ? block.tableRows?.length
        ? block.tableRows
        : parseTableRows(block.text)
      : [];
  const malformedTable =
    block.type === "table" &&
    (!rows.length ||
      rows.length < 2 ||
      Math.max(0, ...rows.map((row) => row.length)) < 2 ||
      Math.max(...rows.map((row) => row.length)) - Math.min(...rows.map((row) => row.length)) > 2);
  const isFigure = block.type === "figure" || block.visualKind === "figure";
  const isFormula =
    block.type === "formula" || (block.visualKind === "formula" && block.type === "paragraph");
  const isTable = block.type === "table" || block.visualKind === "table";
  const shouldPreserve =
    visualMode === "source" || isFigure || isFormula || (isTable && malformedTable);
  if (!shouldPreserve) return null;

  const crop = await cropVisualRegion(sourcePath, region).catch(() => null);
  if (!crop) return null;
  const maxWidth = A4_WIDTH - MARGIN * 2;
  const maxHeight = isFormula ? 118 : isTable ? 285 : 250;
  const scale = Math.min(maxWidth / crop.width, maxHeight / crop.height, 1.75);
  const imageWidth = Math.max(40, crop.width * scale);
  const imageHeight = Math.max(22, crop.height * scale);
  const captionText = isFigure
    ? String(
        block.caption ||
          (block.text && !/^figure or diagram preserved/i.test(block.text)
            ? block.text
            : "Figure / diagram"),
      )
    : isFormula
      ? "Source mathematical notation"
      : "Source table preserved because automatic cell reconstruction is uncertain";
  const captionLines = wrap(captionText, request.fonts.sans, 8.2, maxWidth - 16).slice(0, 3);
  const transcriptionLines =
    isFormula && block.text.trim()
      ? wrap(
          `OCR transcription: ${block.text.trim()}`,
          request.fonts.mono,
          8.4,
          maxWidth - 16,
        ).slice(0, 4)
      : [];
  const totalHeight = imageHeight + captionLines.length * 11 + transcriptionLines.length * 11 + 24;
  request.ensureSpace(totalHeight);
  const page = request.getPage();
  let cursorY = request.cursorY;
  // ensureSpace may have created a fresh page and reset the closure cursor. The
  // standard top position is a safe drawing origin in that case.
  if (cursorY - totalHeight < MARGIN + FOOTER_HEIGHT) cursorY = A4_HEIGHT - MARGIN - 18;
  const x = MARGIN + Math.max(0, (maxWidth - imageWidth) / 2);
  const imageY = cursorY - imageHeight;
  const embedded = await request.pdf.embedPng(crop.bytes);
  page.drawRectangle({
    x: x - 5,
    y: imageY - 5,
    width: imageWidth + 10,
    height: imageHeight + 10,
    color: rgb(0.985, 0.987, 0.99),
    borderColor: rgb(0.62, 0.66, 0.72),
    borderWidth: 0.65,
  });
  page.drawImage(embedded, { x, y: imageY, width: imageWidth, height: imageHeight });
  let textY = imageY - 15;
  for (const line of captionLines) {
    const printable = safe(line);
    const width = request.fonts.sans.widthOfTextAtSize(printable, 8.2);
    page.drawText(printable, {
      x: Math.max(MARGIN, (A4_WIDTH - width) / 2),
      y: textY,
      size: 8.2,
      font: request.fonts.sans,
      color: rgb(0.34, 0.37, 0.42),
    });
    textY -= 11;
  }
  for (const line of transcriptionLines) {
    page.drawText(safe(line), {
      x: MARGIN + 8,
      y: textY,
      size: 8.4,
      font: request.fonts.mono,
      color: rgb(0.16, 0.18, 0.22),
    });
    textY -= 11;
  }
  return { cursorY: textY - 5, consumed: true };
}

async function cropVisualRegion(
  sourcePath: string,
  region: { left: number; top: number; width: number; height: number },
) {
  const image = sharp(sourcePath, { limitInputPixels: 160_000_000 });
  const metadata = await image.metadata();
  const sourceWidth = Math.max(1, Number(metadata.width || 1));
  const sourceHeight = Math.max(1, Number(metadata.height || 1));
  const padding = Math.max(4, Math.round(Math.min(region.width, region.height) * 0.025));
  const left = Math.max(0, Math.min(sourceWidth - 1, Math.floor(region.left - padding)));
  const top = Math.max(0, Math.min(sourceHeight - 1, Math.floor(region.top - padding)));
  const width = Math.max(1, Math.min(sourceWidth - left, Math.ceil(region.width + padding * 2)));
  const height = Math.max(1, Math.min(sourceHeight - top, Math.ceil(region.height + padding * 2)));
  const bytes = await sharp(sourcePath, { limitInputPixels: 160_000_000 })
    .extract({ left, top, width, height })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes, width, height };
}

export async function createSearchableScanPdf(
  title: string,
  structure: OcrStructure,
  enhancedPaths: string[],
) {
  if (!enhancedPaths.length)
    return createStructuredPdf(title, structure, {}, { preserveSourcePages: true });
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("EduSearch AI");
  pdf.setSubject("Enhanced searchable OCR scan");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sortedPages = [...structure.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );

  for (const [index, imagePath] of enhancedPaths.entries()) {
    const bytes = await readFile(imagePath);
    const image = await pdf.embedPng(bytes);
    const sourcePage = sortedPages[index];
    const sourceWidth = sourcePage?.width || image.width;
    const sourceHeight = sourcePage?.height || image.height;
    const scale = Math.min(A4_WIDTH / image.width, A4_HEIGHT / image.height);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    const xOffset = (A4_WIDTH - imageWidth) / 2;
    const yOffset = (A4_HEIGHT - imageHeight) / 2;
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    page.drawImage(image, { x: xOffset, y: yOffset, width: imageWidth, height: imageHeight });
    const scaleX = imageWidth / Math.max(1, sourceWidth);
    const scaleY = imageHeight / Math.max(1, sourceHeight);
    for (const block of sourcePage?.blocks || []) {
      if (!block.bbox || !block.text.trim()) continue;
      const fontSize = Math.max(4, Math.min(22, block.bbox.height * scaleY * 0.8));
      const x = xOffset + block.bbox.left * scaleX;
      const y = yOffset + imageHeight - (block.bbox.top + block.bbox.height) * scaleY;
      const lines = wrap(block.text, font, fontSize, Math.max(20, block.bbox.width * scaleX));
      page.drawText(lines.map(safe).join("\n"), {
        x,
        y,
        size: fontSize,
        lineHeight: Math.max(fontSize, block.bbox.height * scaleY),
        font,
        color: rgb(1, 1, 1),
        opacity: 0,
        maxWidth: Math.max(20, block.bbox.width * scaleX),
      });
    }
  }
  return Buffer.from(await pdf.save());
}

export async function createStructuredDocx(
  title: string,
  structure: OcrStructure,
  requested: PdfReconstructionOptions = {},
) {
  const template = resolveTemplate(structure, requested.template);
  const preserveAnswerSpace = requested.preserveAnswerSpace !== false && template === "exam";
  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  const sortedPages = [...structure.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );
  for (const [pageIndex, page] of sortedPages.entries()) {
    if (pageIndex > 0 && requested.preserveSourcePages)
      children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const block of [...page.blocks].sort((left, right) => left.order - right.order)) {
      const text = formatBlockText(block);
      if (!text || block.type === "footer" || block.repeated) continue;
      const visual = await createDocxVisualParagraphs(block, requested);
      if (visual) {
        children.push(...visual.paragraphs);
        if (visual.consumed) continue;
      }
      const spacingAfter = Math.round(
        Math.min(preserveAnswerSpace ? 72 : 24, block.spacingAfter || 0) * 20,
      );
      if (block.type === "institution") {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text, bold: true, size: 23 })],
            spacing: { after: Math.max(100, spacingAfter) },
          }),
        );
      } else if (block.type === "title") {
        children.push(
          new Paragraph({
            text,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: Math.max(220, spacingAfter) },
          }),
        );
      } else if (block.type === "section") {
        children.push(
          new Paragraph({
            text: text.toUpperCase(),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 220, after: Math.max(100, spacingAfter) },
            keepNext: true,
          }),
        );
      } else if (block.type === "instruction") {
        children.push(
          new Paragraph({
            children: [new TextRun({ text, italics: true })],
            spacing: { before: 100, after: Math.max(140, spacingAfter) },
            keepNext: true,
          }),
        );
      } else if (block.answerLines && /^(?:[_ .-]{5,})$/.test(text)) {
        for (let index = 0; index < Math.max(1, Math.min(12, block.answerLines)); index += 1) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: "________________________________________________________________",
                }),
              ],
              spacing: { after: 120 },
            }),
          );
        }
      } else if (block.mathDetected && (block.type === "paragraph" || block.type === "formula")) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text, font: "Courier New", size: 20 })],
            spacing: { before: 80, after: Math.max(120, spacingAfter) },
            shading: { fill: "F3F5F9" },
          }),
        );
      } else if (block.type === "question" || block.type === "subquestion") {
        children.push(
          new Paragraph({
            children: [new TextRun({ text, bold: block.type === "question" })],
            indent: block.type === "subquestion" ? { left: 360 } : undefined,
            spacing: { before: 100, after: Math.max(100, spacingAfter), line: 300 },
            keepNext: true,
          }),
        );
      } else if (block.type === "table") {
        const rows = block.tableRows?.length ? block.tableRows : parseTableRows(block.text);
        const columns = Math.min(8, Math.max(0, ...rows.map((row) => row.length)));
        if (columns > 1) {
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: rows.map(
                (row, rowIndex) =>
                  new TableRow({
                    children: Array.from(
                      { length: columns },
                      (_, index) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({ text: row[index] || "", bold: rowIndex === 0 }),
                              ],
                            }),
                          ],
                        }),
                    ),
                  }),
              ),
            }),
          );
        } else
          children.push(
            new Paragraph({
              children: [new TextRun(text)],
              spacing: { after: Math.max(100, spacingAfter), line: 300 },
            }),
          );
      } else {
        children.push(
          new Paragraph({
            children: [new TextRun(text)],
            spacing: { after: Math.max(100, spacingAfter), line: 300 },
          }),
        );
      }
    }
  }
  if (!children.length) children.push(new Paragraph("No reconstructed content was available."));
  const document = new Document({
    creator: "EduSearch AI",
    title,
    description: `Academic document reconstructed by EduSearch AI OCR · ${template} layout`,
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: ["Page ", PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

async function createDocxVisualParagraphs(
  block: OcrBlock,
  requested: PdfReconstructionOptions,
): Promise<{ paragraphs: InstanceType<typeof Paragraph>[]; consumed: boolean } | null> {
  const visualMode = requested.visualMode || "hybrid";
  const sourcePath = requested.sourceImagePaths?.[Math.max(0, block.page - 1)];
  const region = block.sourceRegion || block.bbox;
  if (visualMode === "reconstruct" || !sourcePath || !region) return null;
  const rows =
    block.type === "table"
      ? block.tableRows?.length
        ? block.tableRows
        : parseTableRows(block.text)
      : [];
  const malformedTable =
    block.type === "table" &&
    (!rows.length ||
      rows.length < 2 ||
      Math.max(0, ...rows.map((row) => row.length)) < 2 ||
      Math.max(...rows.map((row) => row.length)) - Math.min(...rows.map((row) => row.length)) > 2);
  const isFigure = block.type === "figure" || block.visualKind === "figure";
  const isFormula =
    block.type === "formula" || (block.visualKind === "formula" && block.type === "paragraph");
  const isTable = block.type === "table" || block.visualKind === "table";
  if (!(visualMode === "source" || isFigure || isFormula || (isTable && malformedTable)))
    return null;
  const crop = await cropVisualRegion(sourcePath, region).catch(() => null);
  if (!crop) return null;
  const scale = Math.min(600 / crop.width, (isFormula ? 160 : 330) / crop.height, 2);
  const width = Math.max(50, Math.round(crop.width * scale));
  const height = Math.max(24, Math.round(crop.height * scale));
  const caption = isFigure
    ? String(block.caption || "Figure / diagram")
    : isFormula
      ? "Source mathematical notation"
      : "Source table preserved because automatic cell reconstruction is uncertain";
  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({ data: crop.bytes, transformation: { width, height }, type: "png" }),
      ],
      spacing: { before: 120, after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: caption, italics: true, size: 17, color: "565B66" })],
      spacing: { after: 100 },
    }),
  ];
  if (isFormula && block.text.trim())
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `OCR transcription: ${block.text.trim()}`,
            font: "Courier New",
            size: 19,
          }),
        ],
        spacing: { after: 120 },
      }),
    );
  return { paragraphs, consumed: true };
}

function resolveTemplate(
  structure: OcrStructure,
  requested: PdfTemplate | undefined,
): Exclude<PdfTemplate, "auto"> {
  if (requested && requested !== "auto" && ["exam", "notes", "compact"].includes(requested))
    return requested;
  const blocks = structure.pages.flatMap((page) => page.blocks);
  const questions = blocks.filter(
    (block) => block.type === "question" || block.type === "subquestion",
  ).length;
  const examSignals = blocks.filter(
    (block) => block.type === "instruction" || block.marks != null,
  ).length;
  return questions >= 2 || examSignals >= 2 ? "exam" : "notes";
}

function estimateBlockHeight(
  block: OcrBlock,
  fonts: FontSet,
  template: Exclude<PdfTemplate, "auto">,
) {
  const text = block.text.trim();
  if (!text) return 0;
  if (block.type === "title")
    return wrap(text, fonts.bold, 16, A4_WIDTH - MARGIN * 2 - 20).length * 20 + 14;
  if (block.type === "section")
    return wrap(text, fonts.sansBold, 11, A4_WIDTH - MARGIN * 2 - 20).length * 15 + 21;
  if (block.type === "instruction")
    return wrap(text, fonts.italic, 10.5, A4_WIDTH - MARGIN * 2 - 24).length * 14 + 27;
  if (block.type === "figure") return 210;
  if (block.type === "formula") return 90;
  if (block.answerLines) return Math.min(12, block.answerLines) * 18 + 5;
  if (block.mathDetected)
    return wrap(text, fonts.mono, 9.6, A4_WIDTH - MARGIN * 2 - 24).length * 14 + 23;
  if (block.type === "question" || block.type === "subquestion")
    return (
      wrap(stripMarksFromText(text, block.marks), fonts.regular, 11, A4_WIDTH - MARGIN * 2 - 70)
        .length *
        15 +
      8 +
      Math.min(50, block.spacingAfter || 0)
    );
  return (
    wrap(text, fonts.regular, template === "compact" ? 10.2 : 10.8, A4_WIDTH - MARGIN * 2).length *
      15 +
    7
  );
}

function drawRunningHeader(
  page: PDFPage,
  title: string,
  sourcePage: number | undefined,
  font: PDFFont,
  bold: PDFFont,
  hasUnreviewedBlocks = false,
) {
  const heading = safe(title).slice(0, 80);
  page.drawText(heading, {
    x: MARGIN,
    y: A4_HEIGHT - 29,
    size: 7.8,
    font: bold,
    color: rgb(0.34, 0.38, 0.44),
  });
  const source = sourcePage ? `Source page ${sourcePage}` : "Reconstructed academic document";
  page.drawText(source, {
    x: A4_WIDTH - MARGIN - font.widthOfTextAtSize(source, 7.8),
    y: A4_HEIGHT - 29,
    size: 7.8,
    font,
    color: rgb(0.42, 0.45, 0.5),
  });
  page.drawLine({
    start: { x: MARGIN, y: A4_HEIGHT - 35 },
    end: { x: A4_WIDTH - MARGIN, y: A4_HEIGHT - 35 },
    thickness: 0.45,
    color: rgb(0.8, 0.82, 0.85),
  });
  if (hasUnreviewedBlocks) {
    const warning = "DRAFT - OCR REVIEW REQUIRED";
    page.drawText(warning, {
      x: (A4_WIDTH - bold.widthOfTextAtSize(warning, 8)) / 2,
      y: A4_HEIGHT - 48,
      size: 8,
      font: bold,
      color: rgb(0.62, 0.12, 0.12),
    });
  }
}

function drawFooter(
  page: PDFPage,
  pageNumber: number,
  totalPages: number,
  font: PDFFont,
  template: string,
) {
  const label = `Page ${pageNumber} of ${totalPages}`;
  page.drawLine({
    start: { x: MARGIN, y: 39 },
    end: { x: A4_WIDTH - MARGIN, y: 39 },
    thickness: 0.45,
    color: rgb(0.82, 0.84, 0.87),
  });
  page.drawText(`EduSearch AI · ${template}`, {
    x: MARGIN,
    y: 24,
    size: 7.5,
    font,
    color: rgb(0.5, 0.52, 0.57),
  });
  page.drawText(label, {
    x: A4_WIDTH - MARGIN - font.widthOfTextAtSize(label, 8),
    y: 24,
    size: 8,
    font,
    color: rgb(0.42, 0.45, 0.5),
  });
}

function formatQuestionNumber(block: OcrBlock) {
  const raw = block.questionNumber?.trim();
  if (!raw) return "";
  return block.type === "subquestion" ? `(${raw})` : `${raw}.`;
}

function formatBlockText(block: OcrBlock) {
  const number = formatQuestionNumber(block);
  const cleanText = stripMarksFromText(block.text.trim(), block.marks);
  const marks = block.marks != null ? ` [${block.marks} mark${block.marks === 1 ? "" : "s"}]` : "";
  return `${number ? `${number} ` : ""}${cleanText}${marks}`.trim();
}

function stripMarksFromText(value: string, marks?: number) {
  if (marks == null) return value;
  return value.replace(/\s*(?:\[|\()?\s*\d{1,3}\s*(?:marks?|mks?)?\s*(?:\]|\))?\s*$/i, "").trim();
}

function calculateTableColumnWidths(rows: string[][], totalWidth: number, columns: number) {
  const weights = Array.from({ length: columns }, (_, column) => {
    const lengths = rows.map((row) => (row[column] || "").length).filter((length) => length > 0);
    return Math.max(
      6,
      lengths.length
        ? lengths.reduce((sum, length) => sum + Math.min(60, length), 0) / lengths.length
        : 6,
    );
  });
  const minimum = 52;
  const reserved = minimum * columns;
  const flexible = Math.max(0, totalWidth - reserved);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => minimum + flexible * (weight / totalWeight));
}

function parseTableRows(text: string) {
  return text
    .split(/\n+/)
    .map((line) =>
      line
        .split(/\s*\|\s*|\t+|\s{3,}/)
        .map((cell) => cell.trim())
        .filter(Boolean),
    )
    .filter((row) => row.length);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function safe(value: string) {
  const symbols: Record<string, string> = {
    "≤": "<=",
    "≥": ">=",
    "≠": "!=",
    "≈": "~=",
    "±": "+/-",
    "×": "x",
    "÷": "/",
    "√": "sqrt",
    "∞": "infinity",
    "∑": "sum",
    "∫": "integral",
    π: "pi",
    µ: "u",
    "°": " degrees",
    α: "alpha",
    β: "beta",
    γ: "gamma",
    δ: "delta",
    θ: "theta",
    λ: "lambda",
    σ: "sigma",
    φ: "phi",
    ω: "omega",
  };
  return value
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[≤≥≠≈±×÷√∞∑∫πµ°αβγδθλσφω]/g, (character) => symbols[character] || character)
    .replace(/[^\x20-\x7E\n•]/g, (character) =>
      character.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?"),
    );
}

export type ReconstructionPreflightIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  page?: number;
  blockId?: string;
};

export type ReconstructionPreflight = {
  ready: boolean;
  score: number;
  errors: ReconstructionPreflightIssue[];
  warnings: ReconstructionPreflightIssue[];
  checks: {
    pages: number;
    blocks: number;
    unresolvedBlocks: number;
    handwritingBlocks: number;
    mathBlocks: number;
    tableBlocks: number;
    malformedTables: number;
    figureBlocks: number;
    preservedVisualBlocks: number;
    missingSourceRegions: number;
    duplicateQuestions: number;
    missingQuestionNumbers: number;
    emptyPages: number;
    hasTitle: boolean;
    hasInstitution: boolean;
    totalMarks: number;
  };
};

/**
 * Validate reconstructed academic content before it is presented as a final PDF.
 * This deliberately distinguishes a downloadable OCR draft from a verified export.
 */
export function assessReconstructionQuality(
  structure: OcrStructure,
  metadata: ReconstructionMetadata = {},
): ReconstructionPreflight {
  const errors: ReconstructionPreflightIssue[] = [];
  const warnings: ReconstructionPreflightIssue[] = [];
  const pages = [...structure.pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const blocks = pages.flatMap((page) => page.blocks.filter((block) => !block.repeated));
  const unresolved = blocks.filter(
    (block) =>
      !block.reviewed &&
      (block.needsReview || block.confidence < 70 || (block.agreement ?? 1) < 0.58),
  );
  const handwriting = blocks.filter((block) => block.handwritingLikely);
  const mathBlocks = blocks.filter((block) => block.mathDetected);
  const tableBlocks = blocks.filter((block) => block.type === "table");
  const figureBlocks = blocks.filter((block) => block.type === "figure");
  const preservedVisualBlocks = blocks.filter(
    (block) => block.preserveAsImage || block.type === "figure" || block.type === "formula",
  );
  const missingSourceRegions = preservedVisualBlocks.filter((block) => {
    const region = block.sourceRegion || block.bbox;
    return !region || region.width < 2 || region.height < 2;
  });
  const malformedTables = tableBlocks.filter((block) => {
    const rows = block.tableRows?.length ? block.tableRows : parseTableRows(block.text);
    if (rows.length < 2) return true;
    const widths = rows.map((row) => row.length).filter(Boolean);
    return (
      !widths.length || Math.max(...widths) < 2 || Math.max(...widths) - Math.min(...widths) > 2
    );
  });
  const emptyPages = pages.filter(
    (page) => !page.blocks.some((block) => block.text.trim() && !block.repeated),
  );
  const questionBlocks = blocks.filter((block) => block.type === "question");
  const normalizedNumbers = questionBlocks
    .map((block) => ({ block, value: normalizeQuestionNumber(block.questionNumber) }))
    .filter((item): item is { block: OcrBlock; value: number } => item.value != null);
  const counts = new Map<number, number>();
  normalizedNumbers.forEach(({ value }) => counts.set(value, (counts.get(value) || 0) + 1));
  const duplicateQuestions = [...counts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const missingQuestionNumbers = questionBlocks.filter(
    (block) => !block.questionNumber?.trim(),
  ).length;
  const hasTitle = Boolean(
    blocks.some((block) => block.type === "title" && block.text.trim()) ||
    String(metadata.title || "").trim(),
  );
  const hasInstitution = Boolean(
    blocks.some((block) => block.type === "institution" && block.text.trim()) ||
    String(metadata.institution || "").trim(),
  );

  for (const block of unresolved.slice(0, 30)) {
    errors.push({
      severity: "error",
      code: "unreviewed-ocr",
      message: "This OCR block is uncertain and has not been verified against the source image.",
      page: block.page,
      blockId: block.id,
    });
  }
  for (const block of handwriting.filter((item) => !item.reviewed).slice(0, 20)) {
    errors.push({
      severity: "error",
      code: "handwriting-review",
      message: "Possible handwriting or severely degraded print must be manually verified.",
      page: block.page,
      blockId: block.id,
    });
  }
  for (const block of mathBlocks
    .filter((item) => !item.reviewed && (item.confidence < 82 || (item.agreement ?? 1) < 0.75))
    .slice(0, 20)) {
    errors.push({
      severity: "error",
      code: "math-review",
      message: "Mathematical notation has not reached the confidence required for a final export.",
      page: block.page,
      blockId: block.id,
    });
  }
  for (const block of missingSourceRegions.slice(0, 20)) {
    errors.push({
      severity: "error",
      code: "missing-source-region",
      message:
        "This visual block is marked for source preservation but has no source crop coordinates.",
      page: block.page,
      blockId: block.id,
    });
  }
  for (const block of figureBlocks
    .filter((item) => !String(item.caption || "").trim())
    .slice(0, 20)) {
    warnings.push({
      severity: "warning",
      code: "figure-caption",
      message:
        "This figure has no verified caption. Add a short description for an organised final PDF.",
      page: block.page,
      blockId: block.id,
    });
  }
  for (const block of malformedTables.slice(0, 20)) {
    const preserved = Boolean(block.preserveAsImage && (block.sourceRegion || block.bbox));
    const issue = {
      severity: preserved && block.reviewed ? ("warning" as const) : ("error" as const),
      code: "table-shape",
      message: preserved
        ? "This table is preserved as a source crop; verify that crop before publication."
        : "This table has inconsistent columns and must be corrected or preserved with a source crop.",
      page: block.page,
      blockId: block.id,
    };
    (issue.severity === "error" ? errors : warnings).push(issue);
  }
  for (const page of emptyPages)
    errors.push({
      severity: "error",
      code: "empty-page",
      message: "No publishable content was detected on this page.",
      page: page.pageNumber,
    });
  if (!hasTitle)
    warnings.push({
      severity: "warning",
      code: "missing-title",
      message: "No reliable document title was detected.",
    });
  if (!hasInstitution)
    warnings.push({
      severity: "warning",
      code: "missing-institution",
      message: "No institution name was detected. This is optional but should be checked.",
    });
  if (structure.stats.declaredTotalMarks != null && structure.stats.marksTotalConsistent === false)
    warnings.push({
      severity: "warning",
      code: "marks-total-mismatch",
      message: `Declared total marks (${structure.stats.declaredTotalMarks}) do not match detected question totals (${structure.stats.totalMarks}). Check whether pages or questions are missing.`,
    });
  if (duplicateQuestions)
    errors.push({
      severity: "error",
      code: "duplicate-question",
      message: `${duplicateQuestions} duplicate main question number${duplicateQuestions === 1 ? " was" : "s were"} detected.`,
    });
  if (missingQuestionNumbers)
    errors.push({
      severity: "error",
      code: "missing-question-number",
      message: `${missingQuestionNumbers} main question${missingQuestionNumbers === 1 ? " is" : "s are"} missing a number.`,
    });
  if (!blocks.length)
    errors.push({
      severity: "error",
      code: "empty-document",
      message: "The reconstruction contains no publishable content.",
    });

  const penalty = Math.min(
    100,
    errors.length * 12 +
      warnings.length * 2 +
      missingSourceRegions.length * 12 +
      (!hasTitle ? 5 : 0),
  );
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return {
    ready: errors.length === 0,
    score,
    errors,
    warnings,
    checks: {
      pages: pages.length,
      blocks: blocks.length,
      unresolvedBlocks: unresolved.length,
      handwritingBlocks: handwriting.length,
      mathBlocks: mathBlocks.length,
      tableBlocks: tableBlocks.length,
      malformedTables: malformedTables.length,
      figureBlocks: figureBlocks.length,
      preservedVisualBlocks: preservedVisualBlocks.length,
      missingSourceRegions: missingSourceRegions.length,
      duplicateQuestions,
      missingQuestionNumbers,
      emptyPages: emptyPages.length,
      hasTitle,
      hasInstitution,
      totalMarks: structure.stats.totalMarks,
      ...(structure.stats.declaredTotalMarks != null
        ? {
            declaredTotalMarks: structure.stats.declaredTotalMarks,
            marksTotalConsistent: structure.stats.marksTotalConsistent,
          }
        : {}),
    },
  };
}

function normalizeQuestionNumber(value: string | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
