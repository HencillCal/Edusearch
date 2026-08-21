import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const dbPath = path.join(dataDir, "edusearch.sqlite");
const thumbnailsDir = path.join(dataDir, "thumbnails");
mkdirSync(thumbnailsDir, { recursive: true });

function escapeXml(unsafe) {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createAcademicCoverSvg(doc) {
  const title = escapeXml(doc.title.slice(0, 85));
  const subject = escapeXml(doc.subject.slice(0, 35));
  const docType = escapeXml((doc.docType || "Academic Document").slice(0, 25));
  const year = doc.year ? String(doc.year) : "2026";
  const pages = doc.pages ? `${doc.pages} pages` : "Document";
  const institution = doc.institution && doc.institution !== "Unknown" ? escapeXml(doc.institution.slice(0, 40)) : "EduSearch Academic Repository";

  const palettes = [
    { bg1: "#0f172a", bg2: "#1e293b", accent: "#38bdf8", badgeBg: "rgba(56, 189, 248, 0.15)", textAccent: "#7dd3fc" },
    { bg1: "#064e3b", bg2: "#022c22", accent: "#34d399", badgeBg: "rgba(52, 211, 153, 0.15)", textAccent: "#6ee7b7" },
    { bg1: "#1e1b4b", bg2: "#0f172a", accent: "#818cf8", badgeBg: "rgba(129, 140, 248, 0.15)", textAccent: "#a5b4fc" },
    { bg1: "#4c1d95", bg2: "#2e1065", accent: "#c084fc", badgeBg: "rgba(192, 132, 252, 0.15)", textAccent: "#d8b4fe" },
    { bg1: "#1c1917", bg2: "#292524", accent: "#fb923c", badgeBg: "rgba(251, 146, 60, 0.15)", textAccent: "#fdba74" },
  ];
  const charCodeSum = (doc.subject || "Academic").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const p = palettes[charCodeSum % palettes.length];

  const words = title.split(" ");
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    if ((currentLine + " " + word).trim().length > 22) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  const displayLines = lines.slice(0, 4);

  return `
<svg width="320" height="420" viewBox="0 0 320 420" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.bg1}" />
      <stop offset="100%" stop-color="${p.bg2}" />
    </linearGradient>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${p.accent}" />
      <stop offset="100%" stop-color="${p.textAccent}" />
    </linearGradient>
  </defs>

  <rect width="320" height="420" fill="url(#bg)" rx="8" />
  <rect x="16" y="16" width="288" height="388" fill="none" stroke="${p.accent}" stroke-opacity="0.3" stroke-width="1.5" rx="6" />
  <rect x="16" y="16" width="288" height="6" fill="url(#headerGrad)" rx="3" />

  <rect x="28" y="36" width="100" height="24" rx="4" fill="${p.badgeBg}" stroke="${p.accent}" stroke-opacity="0.4" stroke-width="1" />
  <text x="78" y="52" fill="${p.textAccent}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" text-anchor="middle">
    ${docType}
  </text>

  <text x="288" y="52" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11" text-anchor="end">
    ${year} · ${pages}
  </text>

  <text x="28" y="94" fill="${p.accent}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" letter-spacing="0.5">
    ${subject.toUpperCase()}
  </text>

  ${displayLines
    .map(
      (line, i) => `
    <text x="28" y="${132 + i * 28}" fill="#f8fafc" font-family="Georgia, Cambria, serif" font-size="20" font-weight="bold">
      ${line}
    </text>
  `,
    )
    .join("")}

  <g opacity="0.18">
    <rect x="28" y="260" width="260" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="274" width="240" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="288" width="250" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="302" width="200" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="316" width="230" height="3" fill="#cbd5e1" rx="1.5" />
  </g>

  <line x1="28" y1="360" x2="292" y2="360" stroke="#334155" stroke-width="1" />
  <circle cx="36" cy="380" r="4" fill="${p.accent}" />
  <text x="48" y="384" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="500">
    ${institution}
  </text>
</svg>
`;
}

async function generateThumbnail(doc) {
  const outputPath = path.join(thumbnailsDir, `${doc.id}.webp`);
  let sourceBuffer = null;
  if (doc.storagePath && existsSync(doc.storagePath)) {
    sourceBuffer = await readFile(doc.storagePath).catch(() => null);
  }

  const fileType = String(doc.fileType || "PDF").toUpperCase();

  if (sourceBuffer && (fileType === "IMAGE" || fileType === "PNG" || fileType === "JPG" || fileType === "JPEG" || fileType === "WEBP")) {
    await sharp(sourceBuffer)
      .resize(320, 420, { fit: "cover", position: "top" })
      .webp({ quality: 85 })
      .toFile(outputPath);
  } else if (sourceBuffer && fileType === "PDF") {
    let rendered = false;
    try {
      await sharp(sourceBuffer, { density: 140, page: 0 })
        .resize(320, 420, { fit: "cover", position: "top" })
        .webp({ quality: 85 })
        .toFile(outputPath);
      rendered = true;
    } catch {
      rendered = false;
    }
    if (!rendered) {
      const svg = createAcademicCoverSvg(doc);
      await sharp(Buffer.from(svg)).resize(320, 420).webp({ quality: 90 }).toFile(outputPath);
    }
  } else {
    const svg = createAcademicCoverSvg(doc);
    await sharp(Buffer.from(svg)).resize(320, 420).webp({ quality: 90 }).toFile(outputPath);
  }

  return outputPath;
}

async function main() {
  if (!existsSync(dbPath)) {
    console.log("Database not found at:", dbPath);
    return;
  }
  const db = new DatabaseSync(dbPath);
  try { db.exec("ALTER TABLE documents ADD COLUMN thumbnail_path TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN thumbnail_status TEXT NOT NULL DEFAULT 'pending';"); } catch {}
  try { db.exec("ALTER TABLE libraries ADD COLUMN join_code_encrypted TEXT;"); } catch {}

  const rows = db.prepare(
    "SELECT id, file_type AS fileType, storage_path AS storagePath, title, subject, doc_type AS docType, year, pages, institution, author FROM documents"
  ).all();

  console.log(`Processing thumbnails for ${rows.length} documents...`);
  let count = 0;
  for (const doc of rows) {
    try {
      const outputPath = await generateThumbnail({
        id: String(doc.id),
        fileType: String(doc.fileType || "PDF"),
        storagePath: doc.storagePath ? String(doc.storagePath) : null,
        title: String(doc.title),
        subject: String(doc.subject),
        docType: String(doc.docType || "Notes"),
        year: doc.year ? Number(doc.year) : 2026,
        pages: doc.pages ? Number(doc.pages) : 1,
        institution: doc.institution ? String(doc.institution) : null,
        author: doc.author ? String(doc.author) : null,
      });
      db.prepare("UPDATE documents SET thumbnail_path=?, thumbnail_status='ready' WHERE id=?").run(outputPath, String(doc.id));
      count++;
      console.log(`[${count}/${rows.length}] Generated thumbnail for "${doc.title}" (${doc.id})`);
    } catch (err) {
      console.error(`Failed thumbnail for ${doc.id}:`, err);
    }
  }
  console.log(`✓ Backfill completed! ${count} thumbnails generated.`);
}

main().catch(console.error);
