import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getDb } from "./db.js";

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");

const thumbnailsDir = path.join(dataDir, "thumbnails");

// Secret key for AES-256-GCM encryption of library join codes
const ENCRYPTION_SECRET = process.env.LIBRARY_CODE_ENCRYPTION_KEY || "edusearch-academic-library-secret-key-32b!";
const ENCRYPTION_KEY = createHash("sha256").update(ENCRYPTION_SECRET).digest(); // 32 bytes

export function encryptJoinCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptJoinCode(payload: string): string | null {
  try {
    const parts = payload.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

export async function ensureThumbnailsDirectory(): Promise<string> {
  if (!existsSync(thumbnailsDir)) {
    await mkdir(thumbnailsDir, { recursive: true });
  }
  return thumbnailsDir;
}

export type ThumbnailDocData = {
  id: string;
  fileType: string;
  storagePath?: string | null;
  title: string;
  subject: string;
  docType: string;
  year?: number | null;
  pages?: number;
  institution?: string | null;
  author?: string | null;
  extractedText?: string;
};

export async function generateDocumentThumbnail(doc: ThumbnailDocData): Promise<string> {
  await ensureThumbnailsDirectory();
  const outputPath = path.join(thumbnailsDir, `${doc.id}.webp`);

  try {
    let sourceBuffer: Buffer | null = null;
    if (doc.storagePath && existsSync(doc.storagePath)) {
      sourceBuffer = await readFile(doc.storagePath);
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
        // Try native Sharp PDF page 0 rendering
        await sharp(sourceBuffer, { density: 140, page: 0 } as any)
          .resize(320, 420, { fit: "cover", position: "top" })
          .webp({ quality: 85 })
          .toFile(outputPath);
        rendered = true;
      } catch {
        rendered = false;
      }

      if (!rendered) {
        // High fidelity visual cover rendering via SVG + Sharp
        const svg = createAcademicCoverSvg(doc);
        await sharp(Buffer.from(svg))
          .resize(320, 420)
          .webp({ quality: 90 })
          .toFile(outputPath);
      }
    } else {
      // DOCX, OCR, or text documents without raw PDF page image
      const svg = createAcademicCoverSvg(doc);
      await sharp(Buffer.from(svg))
        .resize(320, 420)
        .webp({ quality: 90 })
        .toFile(outputPath);
    }

    // Record in database
    const db = getDb();
    db.prepare("UPDATE documents SET thumbnail_path=?, thumbnail_status='ready', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(
      outputPath,
      doc.id,
    );

    return outputPath;
  } catch (error) {
    console.error(`Failed to generate thumbnail for doc ${doc.id}:`, error);
    try {
      const db = getDb();
      db.prepare("UPDATE documents SET thumbnail_status='failed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);
    } catch {}
    throw error;
  }
}

function escapeXml(unsafe: string): string {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createAcademicCoverSvg(doc: ThumbnailDocData): string {
  const title = escapeXml(doc.title.slice(0, 85));
  const subject = escapeXml(doc.subject.slice(0, 35));
  const docType = escapeXml((doc.docType || "Academic Document").slice(0, 25));
  const year = doc.year ? String(doc.year) : "2026";
  const pages = doc.pages ? `${doc.pages} pages` : "Document";
  const institution = doc.institution && doc.institution !== "Unknown" ? escapeXml(doc.institution.slice(0, 40)) : "EduSearch Academic Repository";

  // Pick themed accent colors based on subject
  const palettes = [
    { bg1: "#0f172a", bg2: "#1e293b", accent: "#38bdf8", badgeBg: "rgba(56, 189, 248, 0.15)", textAccent: "#7dd3fc" },
    { bg1: "#064e3b", bg2: "#022c22", accent: "#34d399", badgeBg: "rgba(52, 211, 153, 0.15)", textAccent: "#6ee7b7" },
    { bg1: "#1e1b4b", bg2: "#0f172a", accent: "#818cf8", badgeBg: "rgba(129, 140, 248, 0.15)", textAccent: "#a5b4fc" },
    { bg1: "#4c1d95", bg2: "#2e1065", accent: "#c084fc", badgeBg: "rgba(192, 132, 252, 0.15)", textAccent: "#d8b4fe" },
    { bg1: "#1c1917", bg2: "#292524", accent: "#fb923c", badgeBg: "rgba(251, 146, 60, 0.15)", textAccent: "#fdba74" },
  ];
  const charCodeSum = (doc.subject || "Academic").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const p = palettes[charCodeSum % palettes.length];

  // Wrap title into multiple lines if needed
  const words = title.split(" ");
  const lines: string[] = [];
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
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Base Paper Texture -->
  <rect width="320" height="420" fill="url(#bg)" rx="8" />

  <!-- Academic Paper Header Border -->
  <rect x="16" y="16" width="288" height="388" fill="none" stroke="${p.accent}" stroke-opacity="0.3" stroke-width="1.5" rx="6" />

  <!-- Top Accent Bar -->
  <rect x="16" y="16" width="288" height="6" fill="url(#headerGrad)" rx="3" />

  <!-- Document Type Badge -->
  <rect x="28" y="36" width="100" height="24" rx="4" fill="${p.badgeBg}" stroke="${p.accent}" stroke-opacity="0.4" stroke-width="1" />
  <text x="78" y="52" fill="${p.textAccent}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" text-anchor="middle">
    ${docType}
  </text>

  <!-- File Year & Page Count -->
  <text x="288" y="52" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11" text-anchor="end">
    ${year} · ${pages}
  </text>

  <!-- Subject Category -->
  <text x="28" y="94" fill="${p.accent}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" letter-spacing="0.5">
    ${subject.toUpperCase()}
  </text>

  <!-- Title Lines -->
  ${displayLines
    .map(
      (line, i) => `
    <text x="28" y="${132 + i * 28}" fill="#f8fafc" font-family="Georgia, Cambria, serif" font-size="20" font-weight="bold">
      ${line}
    </text>
  `,
    )
    .join("")}

  <!-- Decorative Document Lines -->
  <g opacity="0.18">
    <rect x="28" y="260" width="260" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="274" width="240" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="288" width="250" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="302" width="200" height="3" fill="#cbd5e1" rx="1.5" />
    <rect x="28" y="316" width="230" height="3" fill="#cbd5e1" rx="1.5" />
  </g>

  <!-- Bottom Institution / Footer -->
  <line x1="28" y1="360" x2="292" y2="360" stroke="#334155" stroke-width="1" />
  <circle cx="36" cy="380" r="4" fill="${p.accent}" />
  <text x="48" y="384" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="500">
    ${institution}
  </text>
</svg>
`;
}
