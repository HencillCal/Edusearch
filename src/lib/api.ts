import type { DocDoc } from "./edusearch-data";

export type ApiDocument = DocDoc & {
  year: number;
  views?: number;
  sizeBytes?: number;
  createdAt?: string;
  status?: string;
  previewStatus?: string;
  downloadStatus?: string;
  isSaved?: boolean;
  ratingCount?: number;
  userRating?: number | null;
  content?: string;
  rejectionReason?: string;
  visibility?: "public" | "library";
  libraryId?: string;
  libraryName?: string;
  libraryRole?: string;
  matchPage?: number;
  matchHeading?: string;
  matchQuery?: string;
  rightsBasis?:
    "own_work" | "permission" | "public_domain" | "institution_authorized" | "unspecified";
  sourceAttribution?: string;
  rightsStatus?: "clear" | "claimed" | "restricted" | "removed";
  rightsRestrictionNote?: string;
};

export type ApiLibrary = {
  id: string;
  name: string;
  slug: string;
  institution: string;
  description: string;
  visibility: "public" | "private";
  role: "owner" | "editor" | "viewer" | "admin" | null;
  isMember: boolean;
  canManage: boolean;
  joinCodeHint: string;
  memberCount: number;
  documentCount: number;
  createdAt: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
};

export type HomeResponse = {
  trending: ApiDocument[];
  recent: ApiDocument[];
  subjects: Array<{ name: string; topics: string[]; count: number }>;
  popularSearches: string[];
  recommendations?: ApiDocument[];
};

export type SearchSuggestion = {
  value: string;
  type: "popular-search" | "subject" | "topic" | "document";
};

export type DocumentSearchMatch = {
  id: number;
  chunkIndex: number;
  page: number;
  heading: string;
  snippet: string;
  highlightedSnippet: string;
  exact: boolean;
  score: number;
};

export type DocumentSearchResponse = {
  query: string;
  count: number;
  matches: DocumentSearchMatch[];
};

export type SearchResponse = {
  query: string;
  count: number;
  expandedTerms: string[];
  correction?: string | null;
  semantic?: { enabled: boolean; used: boolean };
  results: ApiDocument[];
  suggestions: string[];
};

export type OcrBlockType =
  | "institution"
  | "title"
  | "metadata"
  | "instruction"
  | "section"
  | "question"
  | "subquestion"
  | "table"
  | "figure"
  | "formula"
  | "paragraph"
  | "footer";

export type OcrBlock = {
  id: string;
  page: number;
  order: number;
  type: OcrBlockType;
  text: string;
  confidence: number;
  needsReview: boolean;
  reviewed: boolean;
  questionNumber?: string;
  parentId?: string;
  marks?: number;
  bbox?: { left: number; top: number; width: number; height: number };
  agreement?: number;
  alternatives?: string[];
  originalText?: string;
  spacingAfter?: number;
  repeated?: boolean;
  mathDetected?: boolean;
  answerLines?: number;
  tableRows?: string[][];
  handwritingLikely?: boolean;
  reviewReason?: string;
  sourceRegion?: { left: number; top: number; width: number; height: number };
  regionConfidence?: number;
  preserveAsImage?: boolean;
  visualKind?: "figure" | "formula" | "table";
  caption?: string;
};

export type OcrWord = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  page: number;
  line: number;
};

export type OcrLine = {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; left: number; top: number; width: number; height: number };
  words: OcrWord[];
  page: number;
  line: number;
  agreement?: number;
  needsReview?: boolean;
};

export type OcrStructure = {
  version: 1;
  pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
    confidence: number;
    blocks: OcrBlock[];
    lines?: OcrLine[];
    words?: OcrWord[];
  }>;
  stats: {
    pages: number;
    blocks: number;
    lowConfidenceBlocks: number;
    questions: number;
    totalMarks: number;
    marksDetected?: number;
    documentTotal?: number;
    questionTotals?: Record<string, number>;
    sectionTotals?: Record<string, number>;
    declaredTotalMarks?: number;
    marksTotalConsistent?: boolean;
  };
};

export type OcrPipelineReport = {
  engine: "native-tesseract" | "tesseract-js" | "pdf-text-layer" | "vision-provider";
  profile: "auto" | "exam" | "notes" | "table" | "mixed";
  qualityMode: "fast" | "balanced" | "accurate";
  language: string;
  documentType:
    | "exam"
    | "notes"
    | "assignment"
    | "marking_scheme"
    | "practical"
    | "course_outline"
    | "research_document"
    | "mixed";
  qualityScore: number;
  orientationCorrection: number;
  skewAngle: number;
  ensembleAgreement: number;
  disagreementLines: number;
  autoCorrections: number;
  layoutMode: "single-column" | "two-column" | "table";
  selectedPass: string;
  passes: Array<{
    name: string;
    engine: string;
    psm: number;
    confidence: number;
    score: number;
    characters: number;
  }>;
  lowConfidenceLines: number;
  suspiciousCharacterRate: number;
  processingMs: number;
  perspectiveCorrection: boolean;
  illuminationNormalized: boolean;
  cropConfidence: number;
  glareScore: number;
  shadowScore: number;
  contrastScore: number;
  pageConsistency: number;
  mathLines: number;
  tableRows: number;
  visionRefinements: number;
  blurScore: number;
  handwritingRisk: number;
  tableGridScore: number;
  lineDensity: number;
  detectedFigures: number;
  detectedTables: number;
  preservedVisuals: number;
  exportReadiness: number;
  warnings: string[];
  selectedProvider?: string;
  providerAttempts?: Array<{
    provider: string;
    model?: string;
    keySlot?: number;
    outcome: string;
  }>;
};

export type OcrJob = {
  id: string;
  contributorUserId?: string;
  originalFilename: string;
  sourceUrl: string;
  sourcePaths: string[];
  sourceFilenames: string[];
  pageCount: number;
  progress: number;
  pagesCompleted: number;
  currentStage: string;
  enhancedPaths: string[];
  extractedText: string;
  correctedText: string;
  confidence: number;
  qualityScore: number;
  profile: "auto" | "exam" | "notes" | "table" | "mixed";
  language: string;
  qualityMode: "fast" | "balanced" | "accurate";
  stage:
    | "uploaded"
    | "preprocessing"
    | "ocr_running"
    | "ocr_completed"
    | "layout_analysis"
    | "reconstructing"
    | "awaiting_review"
    | "verified"
    | "failed"
    | "published"
    | string;
  diagnostics: Record<string, unknown>;
  pipeline: OcrPipelineReport;
  metadata: Record<string, unknown>;
  structure: OcrStructure;
  revision: number;
  publishedDocumentId?: string;
  rightsBasis:
    "unspecified" | "own_work" | "permission" | "public_domain" | "institution_authorized";
  sourceAttribution: string;
  rightsDeclared: boolean;
  rightsDeclaredBy?: string;
  rightsDeclaredAt?: string;
  status: "processing" | "awaiting_correction" | "ready" | "published" | "failed";
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type OcrPreflightIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  page?: number;
  blockId?: string;
};

export type OcrPreflight = {
  ready: boolean;
  score: number;
  errors: OcrPreflightIssue[];
  warnings: OcrPreflightIssue[];
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
    declaredTotalMarks?: number;
    marksTotalConsistent?: boolean;
  };
};

export type OcrRevision = {
  revision: number;
  note: string;
  createdAt: string;
  createdBy: string;
  stats: OcrStructure["stats"];
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Non-JSON server response.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function downloadUrl(documentId: string, preview = false) {
  return `/api/documents/${encodeURIComponent(documentId)}/${preview ? "preview" : "download"}`;
}
