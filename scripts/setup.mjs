import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
for (const folder of [
  "data",
  "data/uploads",
  "data/staging",
  "data/ocr",
  "data/exports",
  "data/compliance",
]) {
  await mkdir(path.join(root, folder), { recursive: true });
}
try {
  await access(path.join(root, ".env"));
} catch {
  await copyFile(path.join(root, ".env.example"), path.join(root, ".env"));
  console.log("Created .env from .env.example");
}
console.log("EduSearch AI storage is ready.");
console.log("Run: npm run dev");
