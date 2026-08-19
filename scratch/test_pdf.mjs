import { readFile } from "node:fs/promises";
import parserModule from "pdf-parse";

console.log("pdf-parse module:", typeof parserModule);
try {
  const parsePdf = (parserModule.default ?? parserModule);
  console.log("parsePdf type:", typeof parsePdf);
} catch (e) {
  console.error("Error with pdf-parse:", e);
}
