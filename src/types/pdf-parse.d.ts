declare module "pdf-parse" {
  export type PdfParseResult = { text?: string; numpages?: number };
  export default function parsePdf(buffer: Buffer | Uint8Array): Promise<PdfParseResult>;
}
