/**
 * Regenerate thumbnails for all PDF documents that currently have a synthetic cover.
 * Run with: npm run thumbnails:regenerate
 *
 * This deletes the existing WebP file for each PDF doc and reruns thumbnail generation.
 * Real PDFs will use pdftoppm/pdftocairo to render actual first page.
 * Documents where rendering fails get a neutral placeholder (not the purple fake cover).
 */

import path from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// We need to import the compiled output because TypeScript source can't run directly.
// Build must be done first: npm run build
// But since we are in scripts/ we use tsx / ts-node via package.json script.

// Load DB
const Database = (await import("better-sqlite3")).default;
const sharp = (await import("sharp")).default;

const dbPath = path.resolve(rootDir, "data", "edusearch.db");
if (!existsSync(dbPath)) {
  console.error("Database not found at", dbPath);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: false });
const thumbnailsDir = path.resolve(rootDir, "data", "thumbnails");

const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { rm } = await import("node:fs/promises");
const execFileAsync = promisify(execFile);

const docs = db
  .prepare(
    `SELECT id, title, storage_path, file_type, thumbnail_path, thumbnail_status
     FROM documents
     WHERE file_type='PDF' AND status='published'
     ORDER BY created_at DESC`,
  )
  .all();

console.log(`Found ${docs.length} PDF documents to regenerate thumbnails for.`);

let success = 0;
let placeholder = 0;
let failed = 0;

for (const doc of docs) {
  const webpPath = path.join(thumbnailsDir, `${doc.id}.webp`);

  // Delete existing thumbnail file so it gets regenerated
  if (existsSync(webpPath)) {
    try {
      unlinkSync(webpPath);
    } catch {}
  }

  if (!doc.storage_path || !existsSync(doc.storage_path)) {
    console.log(`  [SKIP] ${doc.id} — no storage path`);
    db.prepare(
      "UPDATE documents SET thumbnail_status='failed', thumbnail_version=COALESCE(thumbnail_version,0)+1 WHERE id=?",
    ).run(doc.id);
    failed++;
    continue;
  }

  const rendered = await renderPdfFirstPage(doc.storage_path, webpPath);
  if (rendered) {
    console.log(`  [OK]   ${doc.id} — actual first page rendered`);
    db.prepare(
      "UPDATE documents SET thumbnail_path=?, thumbnail_status='ready', thumbnail_version=COALESCE(thumbnail_version,0)+1 WHERE id=?",
    ).run(webpPath, doc.id);
    success++;
  } else {
    console.log(`  [PLAC] ${doc.id} — neutral placeholder (pdftoppm not available)`);
    await generateNeutralPlaceholder(doc, webpPath);
    db.prepare(
      "UPDATE documents SET thumbnail_path=?, thumbnail_status='ready', thumbnail_version=COALESCE(thumbnail_version,0)+1 WHERE id=?",
    ).run(webpPath, doc.id);
    placeholder++;
  }
}

console.log(`\nDone. ${success} rendered, ${placeholder} placeholders, ${failed} failed.`);

// ----------- helpers -----------

async function renderPdfFirstPage(pdfPath, outputPath) {
  const tmpBase = outputPath.replace(/\.webp$/, "-regen-tmp");

  try {
    await execFileAsync(
      "pdftoppm",
      ["-f", "1", "-l", "1", "-singlefile", "-r", "110", "-png", pdfPath, tmpBase],
      { timeout: 30_000 },
    );
    const tmpPng = `${tmpBase}.png`;
    if (existsSync(tmpPng)) {
      await sharp(tmpPng)
        .resize(220, 290, { fit: "contain", background: { r: 247, g: 246, b: 239, alpha: 1 } })
        .webp({ quality: 85 })
        .toFile(outputPath);
      await rm(tmpPng, { force: true });
      return true;
    }
  } catch {}

  try {
    const tmpCairo = `${tmpBase}-cairo`;
    await execFileAsync(
      "pdftocairo",
      ["-f", "1", "-l", "1", "-singlefile", "-r", "110", "-png", pdfPath, tmpCairo],
      { timeout: 30_000 },
    );
    const tmpPng = `${tmpCairo}.png`;
    if (existsSync(tmpPng)) {
      await sharp(tmpPng)
        .resize(220, 290, { fit: "contain", background: { r: 247, g: 246, b: 239, alpha: 1 } })
        .webp({ quality: 85 })
        .toFile(outputPath);
      await rm(tmpPng, { force: true });
      return true;
    }
  } catch {}

  return false;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function generateNeutralPlaceholder(doc, outputPath) {
  const title = escapeXml((doc.title || "Document").slice(0, 60));
  const svg = `<svg width="220" height="290" viewBox="0 0 220 290" xmlns="http://www.w3.org/2000/svg">
  <rect width="220" height="290" fill="#f7f6ef" rx="4"/>
  <rect width="220" height="290" fill="none" stroke="#e2e0d8" stroke-width="1" rx="4"/>
  <rect x="75" y="60" width="70" height="88" rx="4" fill="#e8e6df" stroke="#c8c5bc" stroke-width="1.5"/>
  <path d="M120 60 L145 85" stroke="#c8c5bc" stroke-width="1.5" fill="none"/>
  <rect x="120" y="60" width="25" height="25" rx="2" fill="#d4d1c9"/>
  <rect x="85" y="98" width="50" height="3" rx="1.5" fill="#b8b5ad"/>
  <rect x="85" y="107" width="42" height="3" rx="1.5" fill="#b8b5ad"/>
  <rect x="85" y="116" width="46" height="3" rx="1.5" fill="#b8b5ad"/>
  <rect x="85" y="125" width="38" height="3" rx="1.5" fill="#b8b5ad"/>
  <rect x="82" y="163" width="56" height="20" rx="3" fill="#6b7280" opacity="0.15"/>
  <text x="110" y="177" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="#6b7280" text-anchor="middle">PDF</text>
  <text x="110" y="215" font-family="system-ui,sans-serif" font-size="11" fill="#374151" text-anchor="middle" dominant-baseline="middle">${title.slice(0, 28)}</text>
  ${title.length > 28 ? `<text x="110" y="232" font-family="system-ui,sans-serif" font-size="11" fill="#374151" text-anchor="middle" dominant-baseline="middle">${escapeXml(doc.title.slice(28, 56))}</text>` : ""}
</svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 85 }).toFile(outputPath);
}
