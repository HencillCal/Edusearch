import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertSameOrigin,
  createSession,
  destroySession,
  hashPassword,
  HttpError,
  requireAdmin,
  requireUser,
  sessionFromRequest,
  verifyPassword,
  type SessionUser,
} from "./auth";
import {
  getDb,
  initializeDatabase,
  jsonArray,
  jsonObject,
  rebuildDocumentChunkIndex,
  refreshDocumentFts,
} from "./db";
import {
  assessReconstructionQuality,
  createSearchableScanPdf,
  createStructuredDocx,
  createStructuredPdf,
} from "./pdf-reconstruction";
import {
  buildOcrStructure,
  contentTypeFromName,
  createDocx,
  createPdf,
  dataDir,
  ensureStorage,
  expandZip,
  extractDocument,
  moveToUploads,
  normalizeOcrStructure,
  ocrEngineHealth,
  ocrStructureToText,
  prepareOcrPage,
  runMultiPageOcr,
  runOcr,
  runPdfOcr,
  scanForViruses,
  storeFile,
  type StoredInput,
  type OcrProfile,
  type OcrQualityMode,
  type OcrStructure,
  type OcrPageEdit,
} from "./files";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const allowedRightsBases = new Set([
  "own_work",
  "permission",
  "public_domain",
  "institution_authorized",
]);
let pendingOcrJobsResumed = false;

export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const healthRequest = url.pathname === "/health" || url.pathname === "/ready";
  const compatibilityRequest = url.pathname === "/extract";
  if (!url.pathname.startsWith("/api/") && !healthRequest && !compatibilityRequest) return null;

  try {
    initializeDatabase();
    resumePendingOcrJobs();
    assertSameOrigin(request);
    rateLimit(request, url.pathname);
    const response = await routeRequest(request, url);
    return secure(response);
  } catch (error) {
    if (error instanceof HttpError)
      return secure(json({ error: error.message, details: error.details }, error.status));
    console.error("EduSearch API error", error);
    return secure(json({ error: "The server could not complete this request." }, 500));
  }
}

async function routeRequest(request: Request, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && (pathname === "/api/health" || pathname === "/health")) return health();
  if (method === "GET" && (pathname === "/api/ready" || pathname === "/ready")) return ready();
  if (method === "POST" && (pathname === "/extract" || pathname === "/api/ocr/extract"))
    return compatibilityExtract(request);
  if (method === "GET" && pathname === "/api/home") return home(request);
  if (method === "GET" && pathname === "/api/subjects") return subjects(request);
  if (method === "GET" && pathname === "/api/search") return search(request, url);
  if (method === "GET" && pathname === "/api/search/suggestions")
    return searchSuggestions(request, url);
  if (method === "POST" && pathname === "/api/contact") return submitContact(request);
  if (method === "POST" && pathname === "/api/copyright-requests/status")
    return copyrightRequestStatus(request);
  if (method === "POST" && pathname === "/api/copyright-requests")
    return submitCopyrightRequest(request);

  if (method === "POST" && pathname === "/api/auth/register") return register(request);
  if (method === "POST" && pathname === "/api/auth/login") return login(request);
  if (method === "POST" && pathname === "/api/auth/logout") return logout(request);
  if (method === "GET" && pathname === "/api/auth/me")
    return json({ user: sessionFromRequest(request) });

  if (method === "POST" && pathname === "/api/uploads/analyze") return analyzeUploads(request);
  if (method === "POST" && pathname === "/api/uploads/submit") return submitUpload(request);
  if (method === "GET" && pathname === "/api/uploads/mine") return myUploads(request);

  if (method === "GET" && pathname === "/api/ocr/jobs") return listOcrJobs(request);
  if (method === "POST" && pathname === "/api/ocr/jobs") return createOcrJob(request);
  const ocrEventsMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/events$/);
  if (ocrEventsMatch && method === "GET") return ocrJobEvents(request, ocrEventsMatch[1]);
  const ocrCancelMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/cancel$/);
  if (ocrCancelMatch && method === "POST") return cancelOcrJob(request, ocrCancelMatch[1]);
  const ocrRetryPageMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/pages\/(\d+)\/retry$/);
  if (ocrRetryPageMatch && method === "POST")
    return retryOcrPage(request, ocrRetryPageMatch[1], Number(ocrRetryPageMatch[2]));
  const ocrVerifyMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/verify$/);
  if (ocrVerifyMatch && method === "POST") return verifyOcrJob(request, ocrVerifyMatch[1]);
  const ocrOriginalPageMatch = pathname.match(
    /^\/api\/ocr\/jobs\/([^/]+)\/pages\/(\d+)\/original$/,
  );
  if (ocrOriginalPageMatch && method === "GET")
    return getOcrSourcePage(request, ocrOriginalPageMatch[1], Number(ocrOriginalPageMatch[2]));
  const ocrEnhancedPageMatch = pathname.match(
    /^\/api\/ocr\/jobs\/([^/]+)\/pages\/(\d+)\/enhanced$/,
  );
  if (ocrEnhancedPageMatch && method === "GET")
    return getOcrPage(request, ocrEnhancedPageMatch[1], Number(ocrEnhancedPageMatch[2]));
  const ocrPageMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/pages\/(\d+)$/);
  if (ocrPageMatch && method === "GET")
    return getOcrPage(request, ocrPageMatch[1], Number(ocrPageMatch[2]));
  const ocrSourcePageMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/source\/pages\/(\d+)$/);
  if (ocrSourcePageMatch && method === "GET")
    return getOcrSourcePage(request, ocrSourcePageMatch[1], Number(ocrSourcePageMatch[2]));
  const ocrSourceMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/source$/);
  if (ocrSourceMatch && method === "GET") return getOcrSource(request, ocrSourceMatch[1]);
  const ocrRevisionsMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/revisions$/);
  if (ocrRevisionsMatch && method === "GET") return getOcrRevisions(request, ocrRevisionsMatch[1]);
  const ocrRestoreMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/revisions\/(\d+)\/restore$/);
  if (ocrRestoreMatch && method === "POST")
    return restoreOcrRevision(request, ocrRestoreMatch[1], Number(ocrRestoreMatch[2]));
  const ocrReprocessMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/reprocess$/);
  if (ocrReprocessMatch && method === "POST") return reprocessOcrJob(request, ocrReprocessMatch[1]);
  const ocrMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)$/);
  if (ocrMatch && method === "GET") return getOcrJob(request, ocrMatch[1]);
  const ocrStructureMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/structure$/);
  if (ocrStructureMatch && method === "PATCH")
    return patchOcrStructure(request, ocrStructureMatch[1]);
  const ocrMetadataMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/metadata$/);
  if (ocrMetadataMatch && method === "PATCH") return patchOcrMetadata(request, ocrMetadataMatch[1]);
  if (ocrMatch && method === "PATCH") return updateOcrJob(request, ocrMatch[1]);
  const ocrPreflightMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/preflight$/);
  if (ocrPreflightMatch && method === "GET") return preflightOcrJob(request, ocrPreflightMatch[1]);
  const ocrExportFileMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/export\/(pdf|docx)$/);
  if (ocrExportFileMatch && method === "GET") {
    url.searchParams.set("format", ocrExportFileMatch[2]);
    return exportOcrJob(request, ocrExportFileMatch[1], url);
  }
  const ocrExportMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/export$/);
  if (ocrExportMatch && method === "GET") return exportOcrJob(request, ocrExportMatch[1], url);
  const ocrPublishMatch = pathname.match(/^\/api\/ocr\/jobs\/([^/]+)\/publish$/);
  if (ocrPublishMatch && method === "POST") return publishOcrJob(request, ocrPublishMatch[1]);

  if (method === "GET" && pathname === "/api/saved") return savedDocuments(request);
  if (method === "GET" && pathname === "/api/recommendations") return recommendations(request, url);
  if (method === "GET" && pathname === "/api/followed-topics") return followedTopics(request);
  if (method === "POST" && pathname === "/api/followed-topics") return followTopic(request);
  if (method === "DELETE" && pathname === "/api/followed-topics")
    return unfollowTopic(request, url);
  if (method === "GET" && pathname === "/api/notifications") return notifications(request);
  if (method === "PATCH" && pathname === "/api/notifications/read-all")
    return markAllNotificationsRead(request);
  const notificationMatch = pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationMatch && method === "PATCH")
    return markNotificationRead(request, notificationMatch[1]);
  if (method === "GET" && pathname === "/api/collections") return collections(request);
  if (method === "POST" && pathname === "/api/collections") return createCollection(request);
  const collectionMatch = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (collectionMatch && method === "GET") return collectionDetail(request, collectionMatch[1]);
  if (collectionMatch && method === "PATCH") return updateCollection(request, collectionMatch[1]);
  if (collectionMatch && method === "DELETE") return deleteCollection(request, collectionMatch[1]);

  if (method === "GET" && pathname === "/api/libraries") return libraries(request);
  if (method === "POST" && pathname === "/api/libraries") return createLibrary(request);
  if (method === "POST" && pathname === "/api/libraries/join") return joinLibrary(request);
  const libraryMatch = pathname.match(/^\/api\/libraries\/([^/]+)$/);
  if (libraryMatch && method === "GET") return libraryDetail(request, libraryMatch[1]);
  if (libraryMatch && method === "PATCH") return updateLibrary(request, libraryMatch[1]);
  if (libraryMatch && method === "DELETE") return deleteLibrary(request, libraryMatch[1]);
  const libraryCodeMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/join-code$/);
  if (libraryCodeMatch && method === "POST")
    return regenerateLibraryJoinCode(request, libraryCodeMatch[1]);
  const libraryDocsMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/documents$/);
  if (libraryDocsMatch && method === "POST")
    return addLibraryDocument(request, libraryDocsMatch[1]);
  if (libraryDocsMatch && method === "DELETE")
    return removeLibraryDocument(request, libraryDocsMatch[1]);
  const libraryMemberMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/members\/([^/]+)$/);
  if (libraryMemberMatch && method === "PATCH")
    return updateLibraryMember(request, libraryMemberMatch[1], libraryMemberMatch[2]);
  if (libraryMemberMatch && method === "DELETE")
    return removeLibraryMember(request, libraryMemberMatch[1], libraryMemberMatch[2]);
  const collectionDocumentMatch = pathname.match(/^\/api\/collections\/([^/]+)\/documents$/);
  if (collectionDocumentMatch && method === "POST")
    return addDocumentToCollection(request, collectionDocumentMatch[1]);
  if (collectionDocumentMatch && method === "DELETE")
    return removeDocumentFromCollection(request, collectionDocumentMatch[1]);

  const saveMatch = pathname.match(/^\/api\/documents\/([^/]+)\/save$/);
  if (saveMatch && method === "POST") return saveDocument(request, saveMatch[1]);
  if (saveMatch && method === "DELETE") return unsaveDocument(request, saveMatch[1]);

  const ratingMatch = pathname.match(/^\/api\/documents\/([^/]+)\/rating$/);
  if (ratingMatch && method === "POST") return rateDocument(request, ratingMatch[1]);
  const reportMatch = pathname.match(/^\/api\/documents\/([^/]+)\/report$/);
  if (reportMatch && method === "POST") return reportDocument(request, reportMatch[1]);
  const insideSearchMatch = pathname.match(/^\/api\/documents\/([^/]+)\/search$/);
  if (insideSearchMatch && method === "GET")
    return searchInsideDocument(request, insideSearchMatch[1], url);

  const downloadMatch = pathname.match(/^\/api\/documents\/([^/]+)\/download$/);
  if (downloadMatch && method === "GET") return downloadDocument(request, downloadMatch[1], false);
  const previewMatch = pathname.match(/^\/api\/documents\/([^/]+)\/preview$/);
  if (previewMatch && method === "GET") return downloadDocument(request, previewMatch[1], true);
  const docMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (docMatch && method === "GET") return documentDetail(request, docMatch[1]);

  if (method === "GET" && pathname === "/api/admin/dashboard") return adminDashboard(request);
  if (method === "GET" && pathname === "/api/admin/documents") return adminDocuments(request, url);
  if (method === "GET" && pathname === "/api/admin/ocr-jobs") return adminOcrJobs(request, url);
  if (method === "GET" && pathname === "/api/admin/missing-searches")
    return missingSearches(request);
  if (method === "GET" && pathname === "/api/admin/reports") return adminReports(request, url);
  if (method === "GET" && pathname === "/api/admin/copyright-requests")
    return adminCopyrightRequests(request, url);
  if (method === "GET" && pathname === "/api/admin/taxonomy") return adminTaxonomy(request);
  if (method === "GET" && pathname === "/api/admin/audit") return adminAudit(request, url);
  if (method === "GET" && pathname === "/api/admin/users") return adminUsers(request, url);
  if (method === "POST" && pathname === "/api/admin/users") return createAdminUser(request);
  if (method === "POST" && pathname === "/api/admin/search/reindex") return reindexSearch(request);
  if (method === "POST" && pathname === "/api/admin/subjects") return createSubject(request);
  if (method === "POST" && pathname === "/api/admin/topics") return createTopic(request);
  const adminReportMatch = pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
  if (adminReportMatch && method === "PATCH") return updateReport(request, adminReportMatch[1]);
  const copyrightEvidenceMatch = pathname.match(
    /^\/api\/admin\/copyright-requests\/([^/]+)\/evidence$/,
  );
  if (copyrightEvidenceMatch && method === "GET")
    return copyrightEvidence(request, copyrightEvidenceMatch[1]);
  const copyrightRequestMatch = pathname.match(/^\/api\/admin\/copyright-requests\/([^/]+)$/);
  if (copyrightRequestMatch && method === "PATCH")
    return updateCopyrightRequest(request, copyrightRequestMatch[1]);
  const adminSubjectMatch = pathname.match(/^\/api\/admin\/subjects\/(\d+)$/);
  if (adminSubjectMatch && method === "PATCH")
    return updateSubject(request, Number(adminSubjectMatch[1]));
  if (adminSubjectMatch && method === "DELETE")
    return deleteSubject(request, Number(adminSubjectMatch[1]));
  const adminTopicMatch = pathname.match(/^\/api\/admin\/topics\/(\d+)$/);
  if (adminTopicMatch && method === "PATCH")
    return updateTopic(request, Number(adminTopicMatch[1]));
  if (adminTopicMatch && method === "DELETE")
    return deleteTopic(request, Number(adminTopicMatch[1]));
  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && method === "PATCH") return updateAdminUser(request, adminUserMatch[1]);
  if (adminUserMatch && method === "DELETE") return deleteAdminUser(request, adminUserMatch[1]);
  const adminContactMatch = pathname.match(/^\/api\/admin\/contact-messages\/([^/]+)$/);
  if (adminContactMatch && method === "PATCH")
    return updateContactMessage(request, adminContactMatch[1]);
  const adminDocMatch = pathname.match(/^\/api\/admin\/documents\/([^/]+)$/);
  if (adminDocMatch && method === "PATCH") return moderateDocument(request, adminDocMatch[1]);
  if (adminDocMatch && method === "DELETE") return deleteAdminDocument(request, adminDocMatch[1]);

  throw new HttpError(404, "API endpoint not found.");
}

async function ready() {
  const database = getDb();
  await ensureStorage();
  const storageReady = ["uploads", "staging", "ocr", "exports"].every((folder) =>
    existsSync(path.join(dataDir, folder)),
  );
  return json(
    {
      ready: storageReady,
      database: database ? "ok" : "unavailable",
      storage: storageReady ? "ok" : "unavailable",
      ocr: {
        geminiConfigured: Boolean(process.env.GEMINI_API_KEYS || process.env.API_KEYS),
        aimlConfigured: Boolean(process.env.AIML_API_KEYS),
        openaiConfigured: Boolean(process.env.OPENAI_API_KEYS),
        groqConfigured: Boolean(process.env.GROQ_API_KEYS),
        ocrTextractConfigured: Boolean(process.env.OCR_TEXTRACT_URL),
      },
      uptime: Math.floor(process.uptime()),
    },
    storageReady ? 200 : 503,
  );
}

async function health() {
  const db = getDb();
  const engine = await ocrEngineHealth();
  const documentCount = (
    db.prepare("SELECT COUNT(*) AS count FROM documents").get() as { count: number }
  ).count;
  const chunkCount = (
    db.prepare("SELECT COUNT(*) AS count FROM document_chunks").get() as { count: number }
  ).count;
  return json({
    status: "ok",
    database: "sqlite-wal",
    documents: documentCount,
    searchableChunks: chunkCount,
    ocr: {
      ...engine,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEYS || process.env.API_KEYS),
      aimlConfigured: Boolean(process.env.AIML_API_KEYS),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEYS),
      groqConfigured: Boolean(process.env.GROQ_API_KEYS),
      ocrTextractConfigured: Boolean(process.env.OCR_TEXTRACT_URL),
    },
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
}

function home(request: Request) {
  const db = getDb();
  const user = sessionFromRequest(request);
  const access = documentAccess(user, "d");
  const trending = db
    .prepare(
      `SELECT d.* FROM documents d WHERE d.status='published' AND ${access.sql} ORDER BY d.downloads DESC, d.views DESC LIMIT 4`,
    )
    .all(...access.params) as Array<Record<string, unknown>>;
  const recent = db
    .prepare(
      `SELECT d.* FROM documents d WHERE d.status='published' AND ${access.sql} ORDER BY datetime(d.created_at) DESC LIMIT 4`,
    )
    .all(...access.params) as Array<Record<string, unknown>>;
  const subjectRows = db
    .prepare(
      `
    SELECT s.name, s.description, COUNT(d.id) AS count
    FROM subjects s LEFT JOIN documents d ON lower(d.subject)=lower(s.name) AND d.status='published' AND ${access.sql}
    GROUP BY s.id ORDER BY s.name
  `,
    )
    .all(...access.params) as Array<Record<string, unknown>>;
  const topicRows = db.prepare("SELECT name, subject_id FROM topics ORDER BY name").all() as Array<{
    name: string;
    subject_id: number | null;
  }>;
  const subjectIds = db.prepare("SELECT id,name FROM subjects").all() as Array<{
    id: number;
    name: string;
  }>;
  const topicsBySubject = new Map<number, string[]>();
  topicRows.forEach((topic) => {
    if (topic.subject_id == null) return;
    topicsBySubject.set(topic.subject_id, [
      ...(topicsBySubject.get(topic.subject_id) ?? []),
      topic.name,
    ]);
  });
  const idByName = new Map(subjectIds.map((subject) => [subject.name, subject.id]));
  const popularRows = db
    .prepare(
      `
    SELECT query, COUNT(*) AS count FROM search_logs
    WHERE datetime(created_at) > datetime('now','-30 days') AND result_count > 0
      AND json_extract(filters_json,'$.insideDocument') IS NULL
    GROUP BY normalized_query ORDER BY count DESC LIMIT 6
  `,
    )
    .all() as Array<{ query: string }>;

  return json({
    trending: trending.map((row) => mapDocument(row, user)),
    recent: recent.map((row) => mapDocument(row, user)),
    subjects: subjectRows.map((row) => ({
      name: String(row.name),
      count: Number(row.count),
      topics: topicsBySubject.get(idByName.get(String(row.name)) ?? -1)?.slice(0, 8) ?? [],
    })),
    popularSearches: popularRows.length
      ? popularRows.map((row) => row.query)
      : [
          "Artificial Intelligence",
          "Python Programming",
          "Graphic Design",
          "Accounting",
          "Computer Networks",
          "Electrical Installation",
        ],
    recommendations: user ? buildRecommendations(user, 8).map((row) => mapDocument(row, user)) : [],
  });
}

function subjects(request: Request) {
  const db = getDb();
  const user = sessionFromRequest(request);
  const access = documentAccess(user, "d");
  const rows = db
    .prepare(
      `
    SELECT s.id, s.name, s.description,
           COUNT(DISTINCT d.id) AS count
    FROM subjects s
    LEFT JOIN topics t ON t.subject_id = s.id
    LEFT JOIN document_topics dt ON dt.topic_id = t.id
    LEFT JOIN documents d ON (d.id = dt.document_id OR lower(d.subject) = lower(s.name))
         AND d.status = 'published' AND ${access.sql}
    GROUP BY s.id ORDER BY s.name
  `,
    )
    .all(...access.params) as Array<{
    id: number;
    name: string;
    description: string;
    count: number;
  }>;

  const topicStatement = db.prepare(
    `
    SELECT t.id, t.name, t.synonyms_json,
           COUNT(DISTINCT d.id) AS count
    FROM topics t
    LEFT JOIN document_topics dt ON dt.topic_id = t.id
    LEFT JOIN documents d ON (d.id = dt.document_id OR lower(d.topics_json) LIKE '%' || lower(t.name) || '%')
         AND d.status = 'published' AND ${access.sql}
    WHERE t.subject_id = ?
    GROUP BY t.id ORDER BY t.name
  `,
  );

  return json({
    subjects: rows.map((row) => ({
      name: row.name,
      description: row.description,
      count: Number(row.count),
      topics: (
        topicStatement.all(...access.params, row.id) as Array<{
          id: number;
          name: string;
          synonyms_json: string;
          count: number;
        }>
      ).map((topic) => ({
        name: topic.name,
        count: Number(topic.count),
        synonyms: jsonArray(topic.synonyms_json),
      })),
    })),
  });
}

async function search(request: Request, url: URL) {
  const db = getDb();
  const user = sessionFromRequest(request);
  const query = (url.searchParams.get("q") ?? "").trim();
  const docType = url.searchParams.get("docType");
  const year = numberOrNull(url.searchParams.get("year"));
  const fileType = url.searchParams.get("fileType");
  const subject = url.searchParams.get("subject");
  const level = url.searchParams.get("level");
  const language = url.searchParams.get("language");
  const sort = url.searchParams.get("sort") ?? "relevance";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
  const filters = { docType, year, fileType, subject, level, language, sort };

  const access = documentAccess(user, "d");
  const where: string[] = ["d.status='published'", access.sql];
  const params: Array<string | number> = [...access.params];
  addFilter(where, params, "d.doc_type", docType);
  addFilter(where, params, "d.year", year);
  addFilter(where, params, "d.file_type", fileType);
  addFilter(where, params, "d.subject", subject);
  addFilter(where, params, "d.level", level);
  addFilter(where, params, "d.language", language);

  let correction = "";
  let lexical = runLexicalSearch(query, where, params, sort, limit);
  if (query) {
    const proposed = correctSpelling(query);
    if (normalize(proposed) && normalize(proposed) !== normalize(query)) {
      const corrected = runLexicalSearch(proposed, where, params, sort, limit);
      if (corrected.rows.length && corrected.rows.length >= lexical.rows.length) {
        correction = proposed;
        lexical = corrected;
      }
    }
  }

  const semantic = query
    ? await semanticDocumentRows(query, where, params, limit)
    : { rows: [], enabled: false, used: false };
  const rows = mergeSearchRows(lexical.rows, semantic.rows, limit);
  if (query) annotateBestChunkMatches(rows, correction || query);

  db.prepare(
    "INSERT INTO search_logs(query,normalized_query,result_count,filters_json,user_id) VALUES(?,?,?,?,?)",
  ).run(
    query || "All documents",
    normalize(query),
    rows.length,
    JSON.stringify({
      ...filters,
      correction: correction || undefined,
      semanticUsed: semantic.used,
    }),
    user?.id ?? null,
  );

  return json({
    query,
    correction: correction || null,
    expandedTerms: lexical.expanded.expansions,
    semantic: { enabled: semantic.enabled, used: semantic.used },
    count: rows.length,
    results: rows.map((row) => mapDocument({ ...row, match_query: correction || query }, user)),
    suggestions: rows.length ? [] : buildSuggestions(query),
  });
}

function searchSuggestions(request: Request, url: URL) {
  const user = sessionFromRequest(request);
  const rawQuery = (url.searchParams.get("q") || "").trim().slice(0, 160);
  const query = normalize(rawQuery);
  if (query.length < 2) return json({ suggestions: [] });

  const db = getDb();
  const access = documentAccess(user, "d");
  const like = `%${query}%`;
  const starts = `${query}%`;
  const candidates: Array<{ value: string; type: string; popularity: number; priority: number }> =
    [];

  const popular = db
    .prepare(
      `
    SELECT sl.query AS value, COUNT(*) AS popularity
    FROM search_logs sl
    WHERE sl.normalized_query LIKE ? AND sl.result_count > 0 AND sl.query <> 'All documents'
      AND json_extract(sl.filters_json,'$.insideDocument') IS NULL
      AND EXISTS (
        SELECT 1 FROM documents d
        WHERE d.status='published' AND ${access.sql}
          AND (lower(d.title) LIKE '%' || sl.normalized_query || '%'
            OR lower(d.subject) LIKE '%' || sl.normalized_query || '%'
            OR lower(d.description) LIKE '%' || sl.normalized_query || '%')
      )
    GROUP BY sl.normalized_query, sl.query
    ORDER BY CASE WHEN sl.normalized_query LIKE ? THEN 0 ELSE 1 END, popularity DESC, MAX(datetime(sl.created_at)) DESC
    LIMIT 8
  `,
    )
    .all(like, ...access.params, starts) as Array<{ value: string; popularity: number }>;
  popular.forEach((item) =>
    candidates.push({
      value: item.value,
      type: "popular-search",
      popularity: Number(item.popularity),
      priority: 0,
    }),
  );

  const taxonomy = db
    .prepare(
      `
    SELECT name AS value,'subject' AS type,0 AS popularity FROM subjects WHERE lower(name) LIKE ?
    UNION ALL
    SELECT name AS value,'topic' AS type,0 AS popularity FROM topics WHERE lower(name) LIKE ?
    LIMIT 20
  `,
    )
    .all(like, like) as Array<{ value: string; type: string; popularity: number }>;
  taxonomy.forEach((item) =>
    candidates.push({ ...item, priority: normalize(item.value).startsWith(query) ? 1 : 2 }),
  );

  const documents = db
    .prepare(
      `
    SELECT d.title AS value,'document' AS type,d.downloads AS popularity
    FROM documents d
    WHERE d.status='published' AND ${access.sql}
      AND (lower(d.title) LIKE ? OR lower(d.subject) LIKE ?)
    ORDER BY CASE WHEN lower(d.title) LIKE ? THEN 0 ELSE 1 END, d.downloads DESC
    LIMIT 12
  `,
    )
    .all(...access.params, like, like, starts) as Array<{
    value: string;
    type: string;
    popularity: number;
  }>;
  documents.forEach((item) =>
    candidates.push({ ...item, priority: normalize(item.value).startsWith(query) ? 1 : 3 }),
  );

  const seen = new Set<string>();
  const suggestions = candidates
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        right.popularity - left.popularity ||
        left.value.localeCompare(right.value),
    )
    .filter((item) => {
      const key = normalize(item.value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map(({ value, type }) => ({ value, type }));
  return json({ suggestions });
}

function annotateBestChunkMatches(rows: Array<Record<string, unknown>>, query: string) {
  const strictFts = buildChunkFtsQuery(query);
  const relaxedFts = buildRelaxedChunkFtsQuery(query);
  if (!strictFts && !relaxedFts) return;
  const statement = getDb().prepare(`
    SELECT c.page_number AS page, c.heading,
      snippet(document_chunk_fts,3,'<mark>','</mark>',' … ',38) AS snippet,
      bm25(document_chunk_fts,1.5,1.0) AS score
    FROM document_chunk_fts
    JOIN document_chunks c ON c.id=CAST(document_chunk_fts.chunk_id AS INTEGER)
    WHERE document_chunk_fts MATCH ? AND c.document_id=?
    ORDER BY score ASC LIMIT 1
  `);
  for (const row of rows) {
    let match = strictFts
      ? (statement.get(strictFts, String(row.id)) as Record<string, unknown> | undefined)
      : undefined;
    if (!match && relaxedFts && relaxedFts !== strictFts) {
      match = statement.get(relaxedFts, String(row.id)) as Record<string, unknown> | undefined;
    }
    if (!match) continue;
    row.match_page = Number(match.page || 1);
    row.match_heading = String(match.heading || "");
    row.match_snippet = String(match.snippet || row.match_snippet || "");
  }
}

function searchInsideDocument(request: Request, documentId: string, url: URL) {
  const user = sessionFromRequest(request);
  ensurePublishedDocument(documentId, user);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 300);
  if (query.length < 2)
    throw new HttpError(400, "Enter at least two characters to search inside the document.");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 50);
  const db = getDb();
  const strictFts = buildChunkFtsQuery(query);
  const relaxedFts = buildRelaxedChunkFtsQuery(query);
  let rows: Array<Record<string, unknown>> = [];
  const chunkSearch = db.prepare(`
    SELECT c.id,c.chunk_index AS chunkIndex,c.page_number AS page,c.heading,
      snippet(document_chunk_fts,3,'<mark>','</mark>',' … ',48) AS highlightedSnippet,
      c.content,bm25(document_chunk_fts,1.8,1.0) AS score
    FROM document_chunk_fts
    JOIN document_chunks c ON c.id=CAST(document_chunk_fts.chunk_id AS INTEGER)
    WHERE document_chunk_fts MATCH ? AND c.document_id=?
    ORDER BY score ASC,c.page_number ASC,c.chunk_index ASC LIMIT ?
  `);

  if (strictFts)
    rows = chunkSearch.all(strictFts, documentId, limit) as Array<Record<string, unknown>>;
  if (!rows.length && relaxedFts && relaxedFts !== strictFts) {
    rows = chunkSearch.all(relaxedFts, documentId, limit) as Array<Record<string, unknown>>;
  }

  if (!rows.length) {
    const like = `%${query.toLowerCase()}%`;
    rows = db
      .prepare(
        `
      SELECT id,chunk_index AS chunkIndex,page_number AS page,heading,content,0 AS score
      FROM document_chunks WHERE document_id=? AND lower(content) LIKE ?
      ORDER BY page_number,chunk_index LIMIT ?
    `,
      )
      .all(documentId, like, limit) as Array<Record<string, unknown>>;
  }

  const matches = rows.map((row) => {
    const content = String(row.content || "");
    const exact = normalize(content).includes(normalize(query));
    const highlighted = exact
      ? highlightSnippet(content, query)
      : row.highlightedSnippet
        ? String(row.highlightedSnippet)
        : highlightSnippet(content, query);
    return {
      id: Number(row.id),
      chunkIndex: Number(row.chunkIndex || 0),
      page: Number(row.page || 1),
      heading: String(row.heading || ""),
      snippet: stripMarkup(highlighted),
      highlightedSnippet: highlighted,
      exact,
      score: Number(row.score || 0),
    };
  });

  db.prepare(
    "INSERT INTO search_logs(query,normalized_query,result_count,filters_json,user_id) VALUES(?,?,?,?,?)",
  ).run(
    query,
    normalize(query),
    matches.length,
    JSON.stringify({ insideDocument: documentId }),
    user?.id ?? null,
  );
  return json({ query, count: matches.length, matches });
}

function buildChunkFtsQuery(query: string) {
  const cleaned = query.replace(/["']/g, " ").replace(/\s+/g, " ").trim();
  const tokens = tokenize(cleaned).slice(0, 24);
  if (!tokens.length) return "";
  const tokenQuery = tokens.map((token) => `"${token}"*`).join(" AND ");
  return tokens.length > 1 ? `"${cleaned}" OR (${tokenQuery})` : tokenQuery;
}

function buildRelaxedChunkFtsQuery(query: string) {
  const tokens = expandQuery(query)
    .tokens.filter((token) => token.length > 1)
    .slice(0, 40);
  return tokens.map((token) => `"${token.replace(/"/g, "")}"*`).join(" OR ");
}

function highlightSnippet(content: string, query: string) {
  const normalizedContent = content.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const index = normalizedContent.indexOf(normalizedQuery);
  if (index < 0) return content.slice(0, 320);
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + query.length + 180);
  const before = content.slice(start, index);
  const match = content.slice(index, index + query.length);
  const after = content.slice(index + query.length, end);
  return `${start ? "… " : ""}${before}<mark>${match}</mark>${after}${end < content.length ? " …" : ""}`;
}

function runLexicalSearch(
  query: string,
  where: string[],
  params: Array<string | number>,
  sort: string,
  limit: number,
) {
  const db = getDb();
  let rows: Array<Record<string, unknown>> = [];
  const expanded = expandQuery(query);
  if (expanded.tokens.length) {
    const fts = expanded.tokens.map((token) => `"${token.replace(/"/g, "")}"*`).join(" OR ");
    const order =
      sort === "downloads"
        ? "d.downloads DESC"
        : sort === "recent"
          ? "datetime(d.created_at) DESC"
          : "rank ASC, d.downloads DESC";
    rows = db
      .prepare(
        `
      SELECT d.*, bm25(document_fts, 9.0,6.0,4.0,3.0,2.0,1.5,1.0,0.7) AS rank,
             snippet(document_fts, 7, '<mark>', '</mark>', ' … ', 32) AS match_snippet
      FROM document_fts JOIN documents d ON d.id=document_fts.document_id
      WHERE document_fts MATCH ? AND ${where.join(" AND ")}
      ORDER BY ${order} LIMIT ?
    `,
      )
      .all(fts, ...params, limit) as Array<Record<string, unknown>>;
  }

  if (!expanded.tokens.length || rows.length === 0) {
    const likeWhere = [...where];
    const likeParams = [...params];
    if (query) {
      likeWhere.push(
        `(lower(d.title) LIKE ? OR lower(d.subject) LIKE ? OR lower(d.topics_json) LIKE ? OR lower(d.description) LIKE ? OR lower(d.extracted_text) LIKE ? OR EXISTS (
          SELECT 1 FROM document_topics dt JOIN topics t ON t.id=dt.topic_id WHERE dt.document_id=d.id AND lower(t.name) LIKE ?
        ))`,
      );
      const like = `%${query.toLowerCase()}%`;
      likeParams.push(like, like, like, like, like, like);
    }
    const order =
      sort === "downloads"
        ? "d.downloads DESC"
        : sort === "recent"
          ? "datetime(d.created_at) DESC"
          : "d.downloads DESC";
    rows = db
      .prepare(
        `SELECT d.* FROM documents d WHERE ${likeWhere.join(" AND ")} ORDER BY ${order} LIMIT ?`,
      )
      .all(...likeParams, limit) as Array<Record<string, unknown>>;
  }
  return { rows, expanded };
}

async function semanticDocumentRows(
  query: string,
  where: string[],
  params: Array<string | number>,
  limit: number,
): Promise<{ rows: Array<Record<string, unknown>>; enabled: boolean; used: boolean }> {
  const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "");
  const model = process.env.AI_EMBEDDING_MODEL;
  if (!baseUrl || !model) return { rows: [], enabled: false, used: false };

  const db = getDb();
  const candidates = db
    .prepare(
      `
    SELECT d.* FROM documents d WHERE ${where.join(" AND ")}
    ORDER BY d.downloads DESC, datetime(d.created_at) DESC LIMIT 250
  `,
    )
    .all(...params) as Array<Record<string, unknown>>;
  if (!candidates.length) return { rows: [], enabled: true, used: false };

  try {
    const placeholders = candidates.map(() => "?").join(",");
    const existing = db
      .prepare(
        `
      SELECT document_id,vector_json FROM document_embeddings
      WHERE model=? AND document_id IN (${placeholders})
    `,
      )
      .all(model, ...candidates.map((item) => String(item.id))) as Array<{
      document_id: string;
      vector_json: string;
    }>;
    const vectors = new Map(
      existing.map((item) => [item.document_id, parseVector(item.vector_json)]),
    );
    const missing = candidates.filter((item) => !vectors.has(String(item.id))).slice(0, 50);
    const inputs = [query, ...missing.map(embeddingText)];
    const generated = await requestEmbeddings(baseUrl, model, inputs);
    const queryVector = generated[0];
    if (!queryVector?.length) return { rows: [], enabled: true, used: false };

    const insert = db.prepare(`
      INSERT INTO document_embeddings(document_id,model,vector_json,updated_at)
      VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(document_id) DO UPDATE SET model=excluded.model,vector_json=excluded.vector_json,updated_at=CURRENT_TIMESTAMP
    `);
    missing.forEach((item, index) => {
      const vector = generated[index + 1];
      if (!vector?.length) return;
      const id = String(item.id);
      vectors.set(id, vector);
      insert.run(id, model, JSON.stringify(vector));
    });

    const ranked = candidates
      .map((item) => ({
        item,
        score: cosineSimilarity(queryVector, vectors.get(String(item.id)) ?? []),
      }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item, score }) => ({ ...item, semantic_score: score }));
    return { rows: ranked, enabled: true, used: ranked.length > 0 };
  } catch (error) {
    console.warn(
      "Semantic search unavailable; lexical search remains active.",
      error instanceof Error ? error.message : error,
    );
    return { rows: [], enabled: true, used: false };
  }
}

async function requestEmbeddings(baseUrl: string, model: string, input: string[]) {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Embedding provider returned ${response.status}.`);
  const payload = (await response.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  const ordered = [...(payload.data ?? [])].sort(
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
  );
  if (ordered.length !== input.length)
    throw new Error("Embedding provider returned an incomplete vector batch.");
  return ordered.map((item) => (Array.isArray(item.embedding) ? item.embedding.map(Number) : []));
}

function embeddingText(item: Record<string, unknown>) {
  return [
    item.title,
    item.subject,
    jsonArray(item.topics_json).join(", "),
    item.doc_type,
    item.description,
    String(item.extracted_text || "").slice(0, 5000),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}

function parseVector(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function mergeSearchRows(
  lexical: Array<Record<string, unknown>>,
  semantic: Array<Record<string, unknown>>,
  limit: number,
) {
  const merged = [...lexical];
  const ids = new Set(lexical.map((item) => String(item.id)));
  for (const item of semantic) {
    if (ids.has(String(item.id))) continue;
    ids.add(String(item.id));
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged.slice(0, limit);
}

function correctSpelling(query: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT name AS value FROM subjects
    UNION ALL SELECT name AS value FROM topics
    UNION ALL SELECT title AS value FROM documents WHERE status='published' LIMIT 1000
  `,
    )
    .all() as Array<{ value: string }>;
  const vocabulary = new Set(rows.flatMap((row) => tokenize(row.value)));
  let changed = false;
  const corrected = normalize(query)
    .split(/\s+/)
    .map((token) => {
      if (token.length < 4 || vocabulary.has(token)) return token;
      let best = token;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of vocabulary) {
        if (Math.abs(candidate.length - token.length) > 2 || candidate[0] !== token[0]) continue;
        const distance = levenshtein(token, candidate);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      const threshold = Math.max(1, Math.floor(token.length * 0.25));
      if (bestDistance <= threshold) {
        changed = true;
        return best;
      }
      return token;
    });
  return changed ? corrected.join(" ") : query;
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function documentDetail(request: Request, id: string) {
  const db = getDb();
  const user = sessionFromRequest(request);
  const access = documentAccess(user, "d");
  const row = db
    .prepare(`SELECT d.* FROM documents d WHERE d.id=? AND d.status='published' AND ${access.sql}`)
    .get(id, ...access.params) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "Document not found or you do not have access.");
  db.prepare("UPDATE documents SET views=views+1 WHERE id=?").run(id);
  row.views = Number(row.views || 0) + 1;
  const topics = jsonArray(row.topics_json);
  let related = db
    .prepare(
      `
    SELECT d.* FROM documents d
    WHERE d.status='published' AND d.id<>? AND ${access.sql} AND (d.subject=? OR d.topics_json LIKE ?)
    ORDER BY d.downloads DESC LIMIT 4
  `,
    )
    .all(id, ...access.params, String(row.subject), `%${topics[0] ?? "__none__"}%`) as Array<
    Record<string, unknown>
  >;
  if (related.length < 4) {
    const extras = db
      .prepare(
        `SELECT d.* FROM documents d WHERE d.status='published' AND d.id<>? AND ${access.sql} ORDER BY d.downloads DESC LIMIT 4`,
      )
      .all(id, ...access.params) as Array<Record<string, unknown>>;
    related = [
      ...related,
      ...extras.filter((extra) => !related.some((item) => item.id === extra.id)),
    ].slice(0, 4);
  }
  return json({
    document: mapDocument(row, user, true),
    related: related.map((item) => mapDocument(item, user)),
  });
}

async function downloadDocument(request: Request, id: string, preview: boolean) {
  const db = getDb();
  const user = sessionFromRequest(request);
  const access = documentAccess(user, "d");
  const row = db
    .prepare(`SELECT d.* FROM documents d WHERE d.id=? AND d.status='published' AND ${access.sql}`)
    .get(id, ...access.params) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "Document not found or you do not have access.");
  if (!preview && row.download_status !== "allowed")
    throw new HttpError(403, "Downloads are restricted for this document.");

  let bytes: Buffer;
  let filename: string;
  let contentType: string;
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
  const originalName = String(
    row.original_filename || `${slugify(String(row.title))}.${String(row.file_type).toLowerCase()}`,
  );

  if (preview) {
    if (String(row.file_type) === "PDF" && storagePath) {
      bytes = await readFile(storagePath).catch(() => Buffer.alloc(0));
      if (!bytes.length)
        bytes = await createPdf(
          String(row.title),
          String(row.extracted_text || row.description || row.title),
        );
    } else {
      bytes = await createPdf(
        String(row.title),
        String(row.extracted_text || row.description || row.title),
      );
    }
    filename = `${slugify(String(row.title))}-preview.pdf`;
    contentType = "application/pdf";
  } else if (storagePath) {
    bytes = await readFile(storagePath).catch(() => Buffer.alloc(0));
    if (!bytes.length) bytes = await generatedOriginal(row);
    filename = originalName;
    contentType = contentTypeFromName(filename);
  } else {
    bytes = await generatedOriginal(row);
    const extension = String(row.file_type) === "DOCX" ? "docx" : "pdf";
    filename = `${slugify(String(row.title))}.${extension}`;
    contentType = contentTypeFromName(filename);
  }

  if (!preview) {
    db.prepare("UPDATE documents SET downloads=downloads+1 WHERE id=?").run(id);
    db.prepare("INSERT INTO download_logs(document_id,user_id) VALUES(?,?)").run(
      id,
      user?.id ?? null,
    );
  }

  return new Response(arrayBufferBody(bytes), {
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.length),
      "content-disposition": `${preview ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "")}"`,
      "cache-control": preview ? "private, max-age=300" : "private, no-store",
    },
  });
}

async function generatedOriginal(row: Record<string, unknown>) {
  const text = String(row.extracted_text || row.description || row.title);
  return String(row.file_type) === "DOCX"
    ? createDocx(String(row.title), text)
    : createPdf(String(row.title), text);
}

async function submitContact(request: Request) {
  const body = await readJson(request);
  const email = validEmail(body.email);
  const subject = requiredString(body.subject, "Subject").slice(0, 120);
  const message = requiredString(body.message, "Message").slice(0, 5000);
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO contact_messages(id,email,subject,message) VALUES(?,?,?,?)")
    .run(id, email, subject, message);
  audit(null, "contact.submit", "contact_message", id, { subject });
  return json({ ok: true, id }, 201);
}

async function submitCopyrightRequest(request: Request) {
  const form = await request.formData();
  const documentId = requiredString(form.get("documentId"), "Document ID").slice(0, 180);
  const claimantName = requiredString(form.get("claimantName"), "Claimant name").slice(0, 160);
  const claimantEmail = validEmail(form.get("claimantEmail"));
  const claimantOrganization =
    typeof form.get("claimantOrganization") === "string"
      ? String(form.get("claimantOrganization")).trim().slice(0, 180)
      : "";
  const relationship = requiredString(form.get("relationship"), "Relationship");
  const requestedAction = requiredString(form.get("requestedAction"), "Requested action");
  const statement = requiredString(form.get("statement"), "Copyright statement").slice(0, 8000);
  const declaration = ["true", "1", "on", "yes"].includes(
    String(form.get("declaration") || "").toLowerCase(),
  );
  if (
    !new Set(["author", "rights_holder", "authorized_representative", "institution", "other"]).has(
      relationship,
    )
  ) {
    throw new HttpError(400, "Choose a valid relationship to the copyrighted work.");
  }
  if (!new Set(["remove", "restrict", "contact_uploader"]).has(requestedAction)) {
    throw new HttpError(400, "Choose a valid requested action.");
  }
  if (statement.length < 40)
    throw new HttpError(400, "Explain the copyright claim in at least 40 characters.");
  if (!declaration)
    throw new HttpError(
      400,
      "You must confirm that the request is accurate and submitted in good faith.",
    );

  const database = getDb();
  const document = database
    .prepare("SELECT id,title,uploaded_by,rights_status FROM documents WHERE id=?")
    .get(documentId) as Record<string, unknown> | undefined;
  if (!document) throw new HttpError(404, "The referenced document was not found.");

  let evidenceFilename: string | null = null;
  let evidencePath: string | null = null;
  let evidenceMime: string | null = null;
  let evidenceSha256: string | null = null;
  const evidence = form.get("evidence");
  if (evidence instanceof File && evidence.size > 0) {
    const extension = path.extname(evidence.name).toLowerCase();
    if (!new Set([".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp"]).has(extension)) {
      throw new HttpError(415, "Evidence must be a PDF, DOCX or image file.");
    }
    const stored = await storeFile(evidence, "compliance");
    try {
      await scanForViruses(stored.path);
    } catch (error) {
      await unlink(stored.path).catch(() => undefined);
      throw error;
    }
    evidenceFilename = stored.originalName;
    evidencePath = stored.path;
    evidenceMime = stored.mimeType;
    evidenceSha256 = stored.sha256;
  }

  const user = sessionFromRequest(request);
  const id = randomUUID();
  const trackingCode = randomBytes(18).toString("base64url");
  database
    .prepare(
      `
    INSERT INTO copyright_requests(
      id,tracking_hash,document_id,claimant_user_id,claimant_name,claimant_email,claimant_organization,relationship,
      requested_action,statement,evidence_filename,evidence_path,evidence_mime,evidence_sha256
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
    .run(
      id,
      createHash("sha256").update(trackingCode).digest("hex"),
      documentId,
      user?.id ?? null,
      claimantName,
      claimantEmail,
      claimantOrganization,
      relationship,
      requestedAction,
      statement,
      evidenceFilename,
      evidencePath,
      evidenceMime,
      evidenceSha256,
    );
  if (String(document.rights_status || "clear") === "clear") {
    database
      .prepare(
        "UPDATE documents SET rights_status='claimed',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(documentId);
  }
  notifyAdmins(
    "copyright_request",
    "New copyright request",
    `${claimantName} submitted a rights request for ${String(document.title)}.`,
    "/admin",
  );
  audit(user?.id ?? null, "copyright.submit", "copyright_request", id, {
    documentId,
    requestedAction,
    evidence: Boolean(evidencePath),
  });
  return json({ ok: true, id, trackingCode, status: "submitted" }, 201);
}

async function copyrightRequestStatus(request: Request) {
  const body = await readJson(request);
  const id = requiredString(body.id, "Request ID").slice(0, 100);
  const trackingCode = requiredString(body.trackingCode, "Tracking code").slice(0, 200);
  const row = getDb()
    .prepare(
      `
    SELECT c.status,c.resolution_action AS resolutionAction,c.resolution_note AS resolutionNote,
           c.updated_at AS updatedAt,d.title AS documentTitle
    FROM copyright_requests c JOIN documents d ON d.id=c.document_id
    WHERE c.id=? AND c.tracking_hash=?
  `,
    )
    .get(id, createHash("sha256").update(trackingCode).digest("hex"));
  if (!row) throw new HttpError(404, "The request ID and tracking code do not match.");
  return json({ request: row });
}

async function register(request: Request) {
  const body = await readJson(request);
  const name = requiredString(body.name, "Full name").slice(0, 120);
  const email = validEmail(body.email);
  const password = requiredString(body.password, "Password");
  if (password.length < 8) throw new HttpError(400, "Password must contain at least 8 characters.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
    throw new HttpError(409, "An account already uses this email address.");
  const id = randomUUID();
  const firstUser =
    (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count === 0;
  const role = firstUser && process.env.FIRST_USER_ADMIN !== "false" ? "admin" : "user";
  db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)").run(
    id,
    name,
    email,
    await hashPassword(password),
    role,
  );
  createDefaultCollections(id);
  createNotification(
    id,
    "welcome",
    "Welcome to EduSearch AI",
    "Save documents, follow topics and build revision collections from the academic library.",
    "/subjects",
  );
  const session = createSession(id, request);
  return json({ user: { id, name, email, role } }, 201, { "set-cookie": session.cookie });
}

async function login(request: Request) {
  const body = await readJson(request);
  const email = validEmail(body.email);
  const password = requiredString(body.password, "Password");
  const row = getDb()
    .prepare("SELECT id,name,email,password_hash,role FROM users WHERE email=?")
    .get(email) as (SessionUser & { password_hash: string }) | undefined;
  if (!row || !(await verifyPassword(password, row.password_hash)))
    throw new HttpError(401, "Incorrect email or password.");
  const session = createSession(row.id, request);
  const { password_hash: _passwordHash, ...user } = row;
  return json({ user }, 200, { "set-cookie": session.cookie });
}

function logout(request: Request) {
  return json({ ok: true }, 200, { "set-cookie": destroySession(request) });
}

async function analyzeUploads(request: Request) {
  const user = requireUser(request);
  const form = await request.formData();
  const incoming = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (!incoming.length) throw new HttpError(400, "Choose at least one file.");
  if (incoming.length > 25) throw new HttpError(400, "A batch can contain at most 25 files.");
  const analyzed: unknown[] = [];

  for (const file of incoming) {
    const stored = await storeFile(file, "staging");
    const expanded = await expandZip(stored);
    for (const item of expanded) analyzed.push(await analyzeStoredFile(item, user));
  }
  return json({ uploads: analyzed }, 201);
}

async function analyzeStoredFile(file: StoredInput, user: SessionUser) {
  const db = getDb();
  const virusScan = await scanForViruses(file.path);

  const cached = db
    .prepare(
      "SELECT extracted_text, pages, file_type, suggestions_json FROM document_processing_cache WHERE sha256=?",
    )
    .get(file.sha256) as
    | {
        extracted_text: string;
        pages: number;
        file_type: string;
        suggestions_json: string;
      }
    | undefined;

  let extracted: { text: string; pages: number; fileType: string };
  let suggestions: ReturnType<typeof inferMetadata>;

  if (cached) {
    extracted = {
      text: cached.extracted_text,
      pages: Number(cached.pages),
      fileType: cached.file_type,
    };
    suggestions = normalizeMetadata(
      JSON.parse(cached.suggestions_json),
      inferMetadata(file.originalName, extracted.text, extracted.fileType, extracted.pages),
    );
  } else {
    extracted = await extractDocument(file);
    suggestions = await suggestMetadata(
      file.originalName,
      extracted.text,
      extracted.fileType,
      extracted.pages,
    );
    try {
      db.prepare(
        "INSERT OR REPLACE INTO document_processing_cache(sha256, extracted_text, pages, file_type, suggestions_json) VALUES(?,?,?,?,?)",
      ).run(
        file.sha256,
        extracted.text,
        extracted.pages,
        extracted.fileType,
        JSON.stringify(suggestions),
      );
    } catch {
      // ignore cache errors
    }
  }

  const exact = db
    .prepare("SELECT id,title FROM documents WHERE sha256=? LIMIT 1")
    .get(file.sha256) as { id: string; title: string } | undefined;
  const similar = db
    .prepare("SELECT id,title FROM documents WHERE lower(title)=lower(?) LIMIT 1")
    .get(suggestions.title) as { id: string; title: string } | undefined;
  const duplicate = exact
    ? { kind: "exact", documentId: exact.id, title: exact.title }
    : similar
      ? { kind: "title", documentId: similar.id, title: similar.title }
      : { kind: "none" };
  const id = randomUUID();
  getDb()
    .prepare(
      `
    INSERT INTO staged_uploads(
      id,user_id,original_filename,mime_type,file_type,staging_path,sha256,size_bytes,extracted_text,pages,
      suggestions_json,duplicate_json,virus_scan,expires_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
    .run(
      id,
      user.id,
      file.originalName,
      file.mimeType,
      extracted.fileType,
      file.path,
      file.sha256,
      file.size,
      extracted.text,
      extracted.pages,
      JSON.stringify(suggestions),
      JSON.stringify(duplicate),
      virusScan,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    );
  return {
    id,
    originalFilename: file.originalName,
    fileType: extracted.fileType,
    sizeBytes: file.size,
    pages: extracted.pages,
    suggestions,
    duplicate,
    virusScan,
    textPreview: extracted.text.slice(0, 600),
  };
}

async function submitUpload(request: Request) {
  const user = requireUser(request);
  const body = await readJson(request);
  const uploadId = requiredString(body.uploadId, "Upload ID");
  const staged = getDb()
    .prepare("SELECT * FROM staged_uploads WHERE id=? AND user_id=? AND expires_at>?")
    .get(uploadId, user.id, new Date().toISOString()) as Record<string, unknown> | undefined;
  if (!staged) throw new HttpError(404, "This staged upload was not found or has expired.");
  const metadata = normalizeMetadata(body.metadata, jsonObject(staged.suggestions_json));
  const requestedStatus = body.status === "draft" ? "draft" : "awaiting_review";
  const rightsDeclaration = body.rightsDeclaration === true;
  const rightsBasis =
    typeof body.rightsBasis === "string" && allowedRightsBases.has(body.rightsBasis)
      ? body.rightsBasis
      : "unspecified";
  const sourceAttribution =
    typeof body.sourceAttribution === "string" ? body.sourceAttribution.trim().slice(0, 500) : "";
  if (requestedStatus !== "draft" && !rightsDeclaration) {
    throw new HttpError(400, "Confirm that you have the right to upload and share this document.");
  }
  if (requestedStatus !== "draft" && rightsBasis === "unspecified") {
    throw new HttpError(400, "Choose the legal basis for sharing this document.");
  }
  const status =
    requestedStatus === "draft"
      ? "draft"
      : user.role === "admin" || body.publishNow === true
        ? "published"
        : requestedStatus;
  const libraryId =
    typeof body.libraryId === "string" && body.libraryId.trim() ? body.libraryId.trim() : null;
  const library = libraryId ? requireLibraryManager(libraryId, user) : null;
  const visibility = libraryId && body.visibility === "library" ? "library" : "public";
  const id = uniqueDocumentId(metadata.title);
  const storagePath = await moveToUploads(
    String(staged.staging_path),
    id,
    String(staged.original_filename),
  );
  getDb()
    .prepare(
      `
    INSERT INTO documents(
      id,title,subject,topics_json,doc_type,year,level,language,file_type,pages,size_bytes,institution,author,
      upload_source,description,keywords_json,original_filename,storage_path,sha256,extracted_text,status,uploaded_by,visibility,library_id,
      rights_basis,source_attribution,rights_status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
    .run(
      id,
      metadata.title,
      metadata.subject,
      JSON.stringify(metadata.topics),
      metadata.docType,
      metadata.year,
      metadata.level,
      metadata.language,
      String(staged.file_type),
      Number(staged.pages),
      Number(staged.size_bytes),
      metadata.institution || (library?.institution ? String(library.institution) : null),
      metadata.author || null,
      "user-upload",
      metadata.description,
      JSON.stringify(metadata.keywords),
      String(staged.original_filename),
      storagePath,
      String(staged.sha256),
      String(staged.extracted_text),
      status,
      user.id,
      visibility,
      libraryId,
      rightsBasis,
      sourceAttribution,
      "clear",
    );
  syncDocumentTopics(id, metadata.subject, metadata.topics);
  if (libraryId) {
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO library_documents(library_id,document_id,added_by) VALUES(?,?,?)",
      )
      .run(libraryId, id, user.id);
  }
  getDb().prepare("DELETE FROM staged_uploads WHERE id=?").run(uploadId);
  if (status === "published") {
    refreshDocumentFts(id);
    notifyTopicFollowers(id, {
      title: metadata.title,
      subject: metadata.subject,
      topics_json: JSON.stringify(metadata.topics),
      uploaded_by: user.id,
    });
  }
  audit(user.id, "upload.submit", "document", id, { status, libraryId, visibility });
  return json(
    {
      document: mapDocument(getDb().prepare("SELECT * FROM documents WHERE id=?").get(id), user),
      status,
    },
    201,
  );
}

function myUploads(request: Request) {
  const user = requireUser(request);
  const rows = getDb()
    .prepare("SELECT * FROM documents WHERE uploaded_by=? ORDER BY datetime(created_at) DESC")
    .all(user.id) as Array<Record<string, unknown>>;
  return json({ documents: rows.map((row) => mapDocument(row, user, true)) });
}

function listOcrJobs(request: Request) {
  const user = sessionFromRequest(request);
  const rows = user
    ? (getDb()
        .prepare(
          `
    SELECT * FROM ocr_jobs WHERE user_id=? ORDER BY datetime(updated_at) DESC LIMIT 50
  `,
        )
        .all(user.id) as Array<Record<string, unknown>>)
    : (getDb()
        .prepare(
          `
    SELECT * FROM ocr_jobs ORDER BY datetime(updated_at) DESC LIMIT 50
  `,
        )
        .all() as Array<Record<string, unknown>>);
  return json({ jobs: rows.map(mapOcrJob) });
}

async function compatibilityExtract(request: Request) {
  const form = await request.formData();
  const files = [...form.getAll("images"), ...form.getAll("file")].filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
  if (!files.length)
    throw new HttpError(400, "No images uploaded. Please select at least one image.");
  if (files.length > 20)
    throw new HttpError(413, "A maximum of 20 images can be extracted at once.");
  const language = normalizeOcrLanguage(form.get("lang") || form.get("language"));
  const profile = normalizeOcrProfile(form.get("profile") || "mixed");
  const stored: StoredInput[] = [];
  let generatedPaths: string[] = [];
  try {
    for (const file of files) stored.push(await storeFile(file, "staging"));
    const result = await runMultiPageOcr(
      stored.map((file) => ({ path: file.path, originalName: file.originalName })),
      { profile, qualityMode: "balanced", language },
    );
    generatedPaths = result.enhancedPaths.filter(Boolean);
    const failedPages = new Map(result.pageErrors.map((page: { page: number; error: string }) => [page.page, page.error]));
    const results = result.structure.pages.map((page: any, index: number) => {
      const text = page.blocks
        .map((block: any) => block.text)
        .join("\n\n")
        .trim();
      return {
        name: stored[index]?.originalName || `page-${index + 1}`,
        text,
        confidence: page.confidence > 0 ? page.confidence : null,
        success: Boolean(text),
        ...(failedPages.has(index + 1) ? { error: failedPages.get(index + 1) } : {}),
      };
    });
    return json({ results, pages: result.structure.pages.length, engine: result.pipeline.engine });
  } finally {
    await Promise.all(
      [...stored.map((file) => file.path), ...generatedPaths].map((filePath) =>
        unlink(filePath).catch(() => undefined),
      ),
    );
  }
}

async function createOcrJob(request: Request) {
  const user = sessionFromRequest(request);
  const form = await request.formData();
  const rawList = form.getAll("images").length ? form.getAll("images") : form.getAll("file");
  const files = rawList.filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
  if (!files.length) throw new HttpError(400, "Choose at least one image or PDF to scan.");
  if (files.length > 20) throw new HttpError(413, "A single OCR job can contain at most 20 pages.");
  if (files.some((file) => file.size > 20 * 1024 * 1024))
    throw new HttpError(413, "Each OCR image must be 20 MB or smaller.");
  const profile = normalizeOcrProfile(form.get("profile") || form.get("documentProfile"));
  const qualityMode = normalizeOcrQualityMode(form.get("qualityMode") || form.get("ocrMode"));
  const language = normalizeOcrLanguage(form.get("language") || form.get("languages"));
  const combineAsDocument = String(form.get("combineAsDocument") ?? "true") !== "false";
  if (files.length > 1 && files.some((file) => file.name.toLowerCase().endsWith(".pdf")))
    throw new HttpError(
      415,
      "Combine PDF pages separately or upload images for a multi-page OCR job.",
    );
  const storedFiles: StoredInput[] = [];
  try {
    for (const file of files) {
      const stored = await storeFile(file, "ocr");
      if (
        ![
          ".pdf",
          ".jpg",
          ".jpeg",
          ".png",
          ".webp",
          ".bmp",
          ".gif",
          ".tif",
          ".tiff",
          ".heic",
          ".heif",
        ].includes(stored.extension)
      )
        throw new HttpError(415, `Unsupported OCR page type: ${stored.extension || "unknown"}.`);
      await scanForViruses(stored.path);
      storedFiles.push(stored);
    }
  } catch (error) {
    await Promise.all(storedFiles.map((stored) => unlink(stored.path).catch(() => undefined)));
    throw error;
  }
  const sourcePaths = storedFiles.map((stored) => stored.path);
  const sourceNames = storedFiles.map((stored) => stored.originalName);
  let pageEdits: OcrPageEdit[] = [];
  const pageEditsValue = form.get("pageEdits");
  if (typeof pageEditsValue === "string" && pageEditsValue.trim()) {
    try {
      const parsed = JSON.parse(pageEditsValue);
      pageEdits = Array.isArray(parsed) ? parsed.slice(0, storedFiles.length) : [];
    } catch {
      await Promise.all(storedFiles.map((stored) => unlink(stored.path).catch(() => undefined)));
      throw new HttpError(400, "Invalid page editing instructions.");
    }
  }
  const processingFiles = await Promise.all(
    storedFiles.map(async (stored, index) => ({
      ...stored,
      path: await prepareOcrPage(stored.path, pageEdits[index] || {}),
    })),
  );
  const temporaryProcessingPaths = processingFiles
    .map((stored, index) => (stored.path !== storedFiles[index].path ? stored.path : ""))
    .filter(Boolean);
  if (!combineAsDocument && processingFiles.length > 1) {
    const jobs = [];
    for (const [index, processingFile] of processingFiles.entries()) {
      const id = randomUUID();
      const originalPath = sourcePaths[index];
      const originalName = sourceNames[index];
      getDb()
        .prepare(
          `INSERT INTO ocr_jobs(id,user_id,original_filename,source_path,source_paths_json,source_filenames_json,combine_as_document,progress,pages_completed,total_pages,current_stage,status,processing_stage,ocr_profile,ocr_language,ocr_quality_mode)
           VALUES(?,?,?,?,?,?,0,0,0,1,'Upload received','processing','uploaded',?,?,?)`,
        )
        .run(
          id,
          user?.id ?? null,
          originalName,
          originalPath,
          JSON.stringify([originalPath]),
          JSON.stringify([originalName]),
          profile,
          language,
          qualityMode,
        );
      queueOcrJobProcessing(
        id,
        {
          pages: [processingFile],
          originalPaths: [originalPath],
          temporaryPaths: temporaryProcessingPaths.includes(processingFile.path)
            ? [processingFile.path]
            : [],
        },
        {
          profile,
          qualityMode,
          language,
          userId: user?.id ?? null,
          revision: 1,
          note: "Initial separate-document OCR reconstruction",
        },
      );
      jobs.push(getOcrJobRow(id));
    }
    return json({ job: jobs[0], jobs, separateDocuments: true }, 202);
  }
  const id = randomUUID();
  getDb()
    .prepare(
      `
    INSERT INTO ocr_jobs(id,user_id,original_filename,source_path,source_paths_json,source_filenames_json,combine_as_document,progress,pages_completed,total_pages,current_stage,status,processing_stage,ocr_profile,ocr_language,ocr_quality_mode)
    VALUES(?,?,?,?,?,?,?,0,0,?,'Upload received','processing','uploaded',?,?,?)
  `,
    )
    .run(
      id,
      user?.id ?? null,
      sourceNames.join(", "),
      sourcePaths[0],
      JSON.stringify(sourcePaths),
      JSON.stringify(sourceNames),
      combineAsDocument ? 1 : 0,
      storedFiles.length,
      profile,
      language,
      qualityMode,
    );
  queueOcrJobProcessing(
    id,
    {
      pages: processingFiles,
      originalPaths: sourcePaths,
      temporaryPaths: temporaryProcessingPaths,
    },
    {
      profile,
      qualityMode,
      language,
      userId: user?.id ?? null,
      revision: 1,
      note: `Initial ${storedFiles.length}-page OCR reconstruction`,
    },
  );
  return json({ job: getOcrJobRow(id), pageCount: storedFiles.length }, 202);
}

type OcrQueuePage = Pick<StoredInput, "path" | "extension" | "originalName">;
type OcrQueueSource = {
  pages: OcrQueuePage[];
  originalPaths?: string[];
  temporaryPaths?: string[];
};
type OcrQueueOptions = {
  profile: OcrProfile;
  qualityMode: OcrQualityMode;
  language: string;
  userId: string | null;
  revision: number;
  note: string;
  forceImageOcr?: boolean;
  oldEnhancedPaths?: string[];
};

const activeOcrJobs = new Set<string>();

function queueOcrJobProcessing(id: string, source: OcrQueueSource, options: OcrQueueOptions) {
  if (activeOcrJobs.has(id)) return;
  activeOcrJobs.add(id);
  void processOcrJob(id, source, options).finally(() => activeOcrJobs.delete(id));
}

function resumePendingOcrJobs() {
  if (pendingOcrJobsResumed) return;
  pendingOcrJobsResumed = true;
  const rows = getDb()
    .prepare(
      `SELECT * FROM ocr_jobs WHERE status='processing' OR (status NOT IN ('ready','awaiting_correction','published','failed') AND processing_stage IN ('uploaded','preprocessing','ocr_running','ocr_completed','layout_analysis','reconstructing'))`,
    )
    .all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const sourcePaths = jsonArray(row.source_paths_json);
    const sourceNames = jsonArray(row.source_filenames_json);
    const fallbackPath = String(row.source_path || "");
    const paths = sourcePaths.length ? sourcePaths : fallbackPath ? [fallbackPath] : [];
    if (!paths.length) continue;
    queueOcrJobProcessing(
      String(row.id),
      {
        pages: paths.map((sourcePath, index) => ({
          path: sourcePath,
          extension: path.extname(sourcePath).toLowerCase(),
          originalName:
            sourceNames[index] || String(row.original_filename || path.basename(sourcePath)),
          size: 0,
          sha256: "",
          mimeType: "application/octet-stream",
        })),
        originalPaths: paths,
      },
      {
        profile: normalizeOcrProfile(row.ocr_profile),
        qualityMode: normalizeOcrQualityMode(row.ocr_quality_mode),
        language: normalizeOcrLanguage(row.ocr_language),
        userId: row.user_id ? String(row.user_id) : null,
        revision: Number(row.revision || 1),
        note: "Resumed OCR processing after server restart",
        oldEnhancedPaths: jsonArray(row.enhanced_paths_json),
      },
    );
  }
}

async function processOcrJob(id: string, source: OcrQueueSource, options: OcrQueueOptions) {
  const db = getDb();
  const startedAt = Date.now();
  try {
    assertOcrJobActive(id);
    updateOcrProcessingStage(id, "preprocessing");
    updateOcrProcessingStage(id, "ocr_running");
    const firstPage = source.pages[0];
    const isPdf = source.pages.length === 1 && firstPage.extension === ".pdf";
    const result = isPdf
      ? await runPdfOcr(firstPage.path, {
          profile: options.profile,
          qualityMode: options.qualityMode,
          language: options.language,
          forceImageOcr: options.forceImageOcr,
        })
      : await runMultiPageOcr(
          source.pages.map((page) => ({ path: page.path, originalName: page.originalName })),
          {
            profile: options.profile,
            qualityMode: options.qualityMode,
            language: options.language,
            forceImageOcr: options.forceImageOcr,
          },
          (progress: { page: number; total: number; stage: string }) => updateOcrProgress(id, progress),
        );
    assertOcrJobActive(id);
    updateOcrProcessingStage(id, "ocr_completed");
    updateOcrProcessingStage(id, "layout_analysis");
    const structure = normalizeOcrStructure(result.structure, result.text, result.confidence);
    updateOcrProcessingStage(id, "reconstructing");
    const correctedText = ocrStructureToText(structure).trim();
    assertOcrJobActive(id);
    if (!isActualOcrText(correctedText))
      throw new HttpError(422, "OCR completed but no readable source text was found.", {
        stage: "reconstructing",
        diagnostics: { rawTextLength: result.text.length },
      });
    const originalName = source.pages.map((page) => page.originalName).join(", ");
    const sourceExtension = source.pages[0]?.extension || ".jpg";
    const metadata = await suggestMetadata(
      originalName,
      correctedText,
      sourceExtension === ".pdf" ? "PDF" : "Image",
      structure.stats.pages || result.enhancedPaths.length || 1,
    );
    const preflight = assessReconstructionQuality(structure, metadata);
    if (result.qualityScore < 70)
      preflight.errors.push({
        severity: "error",
        code: "ocr-quality",
        message: "Overall OCR quality is below the verified-export threshold.",
      });
    preflight.ready = preflight.errors.length === 0;
    const status = preflight.ready ? "ready" : "awaiting_correction";
    const stage = preflight.ready ? "verified" : "awaiting_review";
    const pipeline = {
      ...result.pipeline,
      processingMs: Number(result.pipeline.processingMs || Date.now() - startedAt),
      documentType: result.pipeline.documentType || inferOcrDocumentType(metadata.docType),
    };
    db.prepare(
      `
      UPDATE ocr_jobs SET enhanced_paths_json=?,extracted_text=?,corrected_text=?,confidence=?,quality_score=?,pipeline_json=?,metadata_json=?,structure_json=?,revision=?,status=?,processing_stage=?,progress=?,pages_completed=?,total_pages=?,current_stage=?,document_type=?,diagnostics_json=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `,
    ).run(
      JSON.stringify(result.enhancedPaths),
      result.text,
      correctedText,
      result.confidence,
      result.qualityScore,
      JSON.stringify(pipeline),
      JSON.stringify({ ...metadata, detectedDocumentType: pipeline.documentType }),
      JSON.stringify(structure),
      options.revision,
      status,
      stage,
      stage === "verified" ? 100 : 90,
      structure.stats.pages,
      structure.stats.pages,
      stage.replaceAll("_", " "),
      pipeline.documentType,
      JSON.stringify({
        engine: pipeline.engine,
        language: options.language,
        durationMs: Date.now() - startedAt,
        source: {
          extensions: source.pages.map((page) => page.extension),
          pageCount: source.pages.length,
        },
        rawCharacters: result.text.length,
        questionsDetected: structure.stats.questions,
        marksDetected: structure.stats.totalMarks,
        lowConfidenceRegions: structure.stats.lowConfidenceBlocks,
      }),
      id,
    );
    persistOcrGeometry(
      id,
      structure,
      result.enhancedPaths,
      pipeline,
      source.originalPaths || source.pages.map((page) => page.path),
      source.pages.map((page) => page.originalName),
      "success",
    );
    db.prepare("DELETE FROM ocr_preflight_results WHERE job_id=? AND revision=?").run(
      id,
      options.revision,
    );
    db.prepare(
      `INSERT INTO ocr_preflight_results(job_id,revision,ready,score,errors_json,warnings_json,checks_json) VALUES(?,?,?,?,?,?,?)`,
    ).run(
      id,
      options.revision,
      preflight.ready ? 1 : 0,
      preflight.score,
      JSON.stringify(preflight.errors),
      JSON.stringify(preflight.warnings),
      JSON.stringify(preflight.checks),
    );
    db.prepare(
      `
      INSERT OR REPLACE INTO ocr_revisions(job_id,revision,corrected_text,metadata_json,structure_json,note,created_by)
      VALUES(?,?,?,?,?,?,?)
    `,
    ).run(
      id,
      options.revision,
      correctedText,
      JSON.stringify({ ...metadata, detectedDocumentType: pipeline.documentType }),
      JSON.stringify(structure),
      options.note,
      options.userId,
    );
    await Promise.all(
      (options.oldEnhancedPaths || [])
        .filter((filePath) => !result.enhancedPaths.includes(filePath))
        .map((filePath) => unlink(filePath).catch(() => undefined)),
    );
    console.info("[EduSearch OCR] completed", {
      jobId: id,
      rawOcrText: result.text,
      detectedQuestions: structure.stats.questions,
      detectedMarks: structure.stats.totalMarks,
      structuredBlocks: structure.stats.blocks,
      preflightScore: preflight.score,
      pdfSource: source.pages.map((page) => page.path),
    });
    audit(options.userId, "ocr.process", "ocr_job", id, {
      pages: structure.stats.pages,
      confidence: result.confidence,
      qualityScore: result.qualityScore,
      questions: structure.stats.questions,
      marks: structure.stats.totalMarks,
      status,
      stage,
    });
  } catch (error) {
    const details = error instanceof HttpError ? error.details : undefined;
    const errorMessage = error instanceof Error ? error.message : "OCR failed";
    const enhancedPath =
      details && typeof details === "object" && !Array.isArray(details)
        ? String((details as Record<string, unknown>).enhancedPath || "")
        : "";
    db.prepare(
      "UPDATE ocr_jobs SET status='failed',processing_stage='failed',error_message=?,diagnostics_json=?,enhanced_paths_json=CASE WHEN ? <> '' THEN json_array(?) ELSE enhanced_paths_json END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(
      errorMessage,
      JSON.stringify({
        ...(details && typeof details === "object" ? details : {}),
        durationMs: Date.now() - startedAt,
      }),
      enhancedPath,
      enhancedPath,
      id,
    );
    console.error("[EduSearch OCR] failed", {
      jobId: id,
      stage: "ocr_running",
      error: errorMessage,
      details,
    });
    audit(options.userId, "ocr.failed", "ocr_job", id, { error: errorMessage, details });
  } finally {
    await Promise.all(
      (source.temporaryPaths || []).map((filePath) => unlink(filePath).catch(() => undefined)),
    );
  }
}

function assertOcrJobActive(id: string) {
  const row = getDb().prepare("SELECT status,error_message FROM ocr_jobs WHERE id=?").get(id) as
    { status?: string; error_message?: string } | undefined;
  if (row?.status === "failed" && /cancelled/i.test(String(row.error_message || "")))
    throw new HttpError(409, "OCR job was cancelled.", { stage: "failed" });
}

function updateOcrProgress(id: string, progress: { page: number; total: number; stage: string }) {
  const completed =
    progress.stage === "ocr_completed" ? progress.page : Math.max(0, progress.page - 1);
  const percent = Math.round(
    Math.max(
      0,
      Math.min(
        99,
        ((completed + (progress.stage === "ocr_completed" ? 1 : 0)) / Math.max(1, progress.total)) *
          75,
      ),
    ),
  );
  getDb()
    .prepare(
      "UPDATE ocr_jobs SET progress=?,pages_completed=?,total_pages=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(
      percent,
      completed,
      progress.total,
      `${progress.stage} page ${progress.page} of ${progress.total}`,
      id,
    );
}

function updateOcrProcessingStage(
  id: string,
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
    | "published",
) {
  const progressByStage: Record<string, number> = {
    uploaded: 0,
    preprocessing: 10,
    ocr_running: 20,
    ocr_completed: 75,
    layout_analysis: 82,
    reconstructing: 90,
    awaiting_review: 100,
    verified: 100,
    failed: 100,
    published: 100,
  };
  getDb()
    .prepare(
      "UPDATE ocr_jobs SET processing_stage=?,progress=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(stage, progressByStage[stage] ?? 0, stage.replaceAll("_", " "), id);
}

function isActualOcrText(value: string) {
  const compact = value.replace(/\s/g, "");
  if (compact.length < 4) return false;
  const readable = (compact.match(/[\p{L}\p{N}]/gu) || []).length;
  return readable >= 4 && readable / compact.length >= 0.35;
}

function inferOcrDocumentType(value: unknown) {
  const normalized = String(value || "").toLowerCase();
  if (/marking|answer/.test(normalized)) return "marking_scheme";
  if (/assignment/.test(normalized)) return "assignment";
  if (/practical|laboratory/.test(normalized)) return "practical";
  if (/outline|syllabus/.test(normalized)) return "course_outline";
  if (/research|thesis/.test(normalized)) return "research_document";
  if (/exam|paper/.test(normalized)) return "exam";
  if (/note/.test(normalized)) return "notes";
  return "mixed";
}

function persistOcrGeometry(
  jobId: string,
  structure: OcrStructure,
  enhancedPaths: string[],
  pipeline: Record<string, unknown>,
  originalPaths: string[] = [],
  originalNames: string[] = [],
  pageStatus: string = "success",
) {
  const db = getDb();
  try {
    db.prepare("DELETE FROM ocr_blocks WHERE job_id=?").run(jobId);
    db.prepare("DELETE FROM ocr_pages WHERE job_id=?").run(jobId);
  } catch {
    // Ignore deletion errors if tables are locked
  }
  const insertPage = db.prepare(
    "INSERT OR REPLACE INTO ocr_pages(job_id,page_number,sort_order,original_filename,original_path,width,height,enhanced_path,raw_text,status,error_message,confidence,diagnostics_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insertLine = db.prepare(
    "INSERT OR REPLACE INTO ocr_lines(page_id,line_number,text,confidence,x,y,width,height,agreement,needs_review) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  const insertWord = db.prepare(
    "INSERT OR REPLACE INTO ocr_words(line_id,word_number,text,confidence,x,y,width,height,page_number,line_number) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  const insertBlock = db.prepare(
    "INSERT OR REPLACE INTO ocr_blocks(id,job_id,page_number,block_order,type,text,confidence,needs_review,reviewed,marks,question_number,bbox_json,structure_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (const page of structure.pages) {
    const pageResult = insertPage.run(
      jobId,
      page.pageNumber,
      page.pageNumber - 1,
      originalNames[page.pageNumber - 1] || `page-${page.pageNumber}`,
      originalPaths[page.pageNumber - 1] || null,
      page.width,
      page.height,
      enhancedPaths[page.pageNumber - 1] || null,
      page.blocks.map((block) => block.text).join("\n"),
      pageStatus,
      null,
      page.confidence,
      JSON.stringify({
        pipeline,
        lineCount: page.lines?.length || 0,
        wordCount: page.words?.length || 0,
      }),
    );
    const pageId = Number(pageResult.lastInsertRowid);
    for (const [lineIndex, line] of (page.lines || []).entries()) {
      const lineResult = insertLine.run(
        pageId,
        line.line || lineIndex + 1,
        line.text,
        line.confidence,
        line.bbox.left,
        line.bbox.top,
        line.bbox.width,
        line.bbox.height,
        line.agreement ?? 1,
        line.needsReview ? 1 : 0,
      );
      const lineId = Number(lineResult.lastInsertRowid);
      for (const [wordIndex, word] of line.words.entries())
        insertWord.run(
          lineId,
          wordIndex + 1,
          word.text,
          word.confidence,
          word.left,
          word.top,
          word.width,
          word.height,
          word.page,
          word.line,
        );
    }
    for (const [blockIndex, block] of page.blocks.entries()) {
      const blockId = `${jobId}_p${page.pageNumber}_b${blockIndex}_${block.id || randomUUID()}`;
      insertBlock.run(
        blockId,
        jobId,
        page.pageNumber,
        block.order || blockIndex + 1,
        block.type,
        block.text,
        block.confidence,
        block.needsReview ? 1 : 0,
        block.reviewed ? 1 : 0,
        block.marks ?? null,
        block.questionNumber ?? null,
        JSON.stringify(block.bbox || null),
        JSON.stringify(block),
      );
    }
  }
}

async function reprocessOcrJob(request: Request, id: string) {
  const { row, user } = requireOcrJobAccess(request, id);
  if (String(row.status) === "published")
    throw new HttpError(409, "Published OCR jobs cannot be reprocessed.");
  const body = await readOptionalJson(request);
  const profile = normalizeOcrProfile(body.profile ?? row.ocr_profile);
  const qualityMode = normalizeOcrQualityMode(body.qualityMode ?? row.ocr_quality_mode);
  const language = normalizeOcrLanguage(body.language ?? row.ocr_language);
  const forceImageOcr = body.forceImageOcr === true;
  const sourcePaths = jsonArray(row.source_paths_json);
  const sourceNames = jsonArray(row.source_filenames_json);
  const fallbackPath = String(row.source_path);
  const paths = sourcePaths.length ? sourcePaths : [fallbackPath];
  const sourcePath = paths[0];
  const extension = path.extname(sourcePath).toLowerCase();
  getDb()
    .prepare(
      "UPDATE ocr_jobs SET status='processing',processing_stage='uploaded',progress=0,pages_completed=0,total_pages=?,current_stage='Upload received',error_message=NULL,ocr_profile=?,ocr_language=?,ocr_quality_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(paths.length, profile, language, qualityMode, id);
  queueOcrJobProcessing(
    id,
    {
      pages: paths.map((pagePath, index) => ({
        path: pagePath,
        extension: path.extname(pagePath).toLowerCase(),
        originalName: sourceNames[index] || String(row.original_filename),
        size: 0,
        sha256: "",
        mimeType: "application/octet-stream",
      })),
      originalPaths: paths,
    },
    {
      profile,
      qualityMode,
      language,
      userId: user?.id ?? null,
      revision: Number(row.revision || 1) + 1,
      note: `Reprocessed with ${qualityMode} ${profile} OCR (${language})`,
      forceImageOcr,
      oldEnhancedPaths: jsonArray(row.enhanced_paths_json),
    },
  );
  return json({ job: getOcrJobRow(id) }, 202);
}

function ocrJobEvents(request: Request, id: string) {
  const { row } = requireOcrJobAccess(request, id);
  const payload = `event: progress\ndata: ${JSON.stringify({
    id,
    status: String(row.status),
    stage: normalizeOcrStage(row),
    progress: Number(row.progress || 0),
    pagesCompleted: Number(row.pages_completed || 0),
    totalPages: Number(row.total_pages || 1),
    currentStage: String(row.current_stage || ""),
  })}\n\n`;
  return new Response(payload, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
    },
  });
}

function cancelOcrJob(request: Request, id: string) {
  const { user } = requireOcrJobAccess(request, id);
  getDb()
    .prepare(
      "UPDATE ocr_jobs SET status='failed',processing_stage='failed',progress=100,current_stage='Cancelled by user',error_message='OCR job cancelled by user',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'",
    )
    .run(id);
  audit(user?.id ?? null, "ocr.cancel", "ocr_job", id, {});
  return json({ job: getOcrJobRow(id) });
}

async function retryOcrPage(request: Request, id: string, pageNumber: number) {
  if (pageNumber < 1) throw new HttpError(400, "Invalid OCR page number.");
  const { row } = requireOcrJobAccess(request, id);
  if (row.status === "published") throw new HttpError(409, "Published OCR jobs cannot be retried.");
  getDb()
    .prepare(
      "UPDATE ocr_jobs SET diagnostics_json=json_set(COALESCE(diagnostics_json,'{}'),'$.retryPage',?),updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(pageNumber, id);
  return reprocessOcrJob(request, id);
}

function verifyOcrJob(request: Request, id: string) {
  const { row, user } = requireOcrJobAccess(request, id);
  const metadata = jsonObject<Record<string, unknown>>(row.metadata_json);
  const structure = normalizeOcrStructure(
    jsonObject(row.structure_json),
    String(row.corrected_text || row.extracted_text || ""),
    Number(row.confidence || 0),
  );
  const result = assessReconstructionQuality(structure, metadata);
  if (Number(row.quality_score || 0) < 70)
    result.errors.push({
      severity: "error",
      code: "ocr-quality",
      message: "Overall OCR quality is below the verified-export threshold.",
    });
  if (result.errors.length)
    throw new HttpError(422, "Verification is blocked by OCR preflight issues.", result);
  getDb()
    .prepare(
      "UPDATE ocr_jobs SET status='ready',processing_stage='verified',progress=100,current_stage='Verified',updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(id);
  audit(user?.id ?? null, "ocr.verify", "ocr_job", id, { revision: row.revision });
  return json({ job: getOcrJobRow(id), preflight: result });
}

function getOcrJob(request: Request, id: string) {
  const { row } = requireOcrJobAccess(request, id);
  return json({ job: mapOcrJob(row) });
}

function getOcrSource(request: Request, id: string) {
  const { row } = requireOcrJobAccess(request, id);
  return servePrivateFile(String(row.source_path), String(row.original_filename));
}

function getOcrSourcePage(request: Request, id: string, pageNumber: number) {
  const { row } = requireOcrJobAccess(request, id);
  const paths = jsonArray(row.source_paths_json);
  const sourcePath = paths[pageNumber - 1] || (pageNumber === 1 ? String(row.source_path) : "");
  const names = jsonArray(row.source_filenames_json);
  if (!sourcePath) throw new HttpError(404, "Original OCR page not found.");
  return servePrivateFile(sourcePath, names[pageNumber - 1] || `ocr-source-page-${pageNumber}`);
}

function getOcrPage(request: Request, id: string, pageNumber: number) {
  const { row } = requireOcrJobAccess(request, id);
  const paths = jsonArray(row.enhanced_paths_json);
  const imagePath = paths[pageNumber - 1];
  if (!imagePath) throw new HttpError(404, "Enhanced OCR page not found.");
  return servePrivateFile(imagePath, `ocr-page-${pageNumber}.png`);
}

function getOcrRevisions(request: Request, id: string) {
  requireOcrJobAccess(request, id);
  const rows = getDb()
    .prepare(
      `
    SELECT r.revision,r.note,r.created_at AS createdAt,u.name AS createdBy,r.structure_json AS structureJson
    FROM ocr_revisions r LEFT JOIN users u ON u.id=r.created_by
    WHERE r.job_id=? ORDER BY r.revision DESC LIMIT 100
  `,
    )
    .all(id) as Array<Record<string, unknown>>;
  return json({
    revisions: rows.map((row) => {
      const structure = normalizeOcrStructure(jsonObject(row.structureJson));
      return {
        revision: Number(row.revision),
        note: String(row.note || ""),
        createdAt: String(row.createdAt),
        createdBy: row.createdBy ? String(row.createdBy) : "Anonymous editor",
        stats: structure.stats,
      };
    }),
  });
}

async function patchOcrStructure(request: Request, id: string) {
  const body = await readJson(request);
  return updateOcrJob(
    new Request(request.url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}),
      },
      body: JSON.stringify({ structure: body.structure || body }),
    }),
    id,
  );
}

async function patchOcrMetadata(request: Request, id: string) {
  const body = await readJson(request);
  return updateOcrJob(
    new Request(request.url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}),
      },
      body: JSON.stringify({ metadata: body.metadata || body }),
    }),
    id,
  );
}

async function updateOcrJob(request: Request, id: string) {
  const { row, user } = requireOcrJobAccess(request, id);
  if (String(row.status) === "published")
    throw new HttpError(
      409,
      "Published OCR jobs cannot be edited. Create a new scan for further changes.",
    );
  const body = await readJson(request);
  const fallbackText =
    typeof body.correctedText === "string"
      ? body.correctedText.slice(0, 2_000_000)
      : String(row.corrected_text || row.extracted_text || "");
  const structure = body.structure
    ? normalizeOcrStructure(body.structure, fallbackText, Number(row.confidence || 0))
    : buildOcrStructure(fallbackText, Number(row.confidence || 0));
  const correctedText = ocrStructureToText(structure).slice(0, 2_000_000);
  if (!isActualOcrText(correctedText))
    throw new HttpError(422, "Cannot save an OCR revision without actual extracted source text.");
  const metadata = body.metadata
    ? normalizeMetadata(body.metadata, jsonObject(row.metadata_json))
    : jsonObject(row.metadata_json);
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 240) : "Saved OCR corrections";
  const revision = Number(row.revision || 1) + 1;
  const preflight = assessReconstructionQuality(structure, metadata);
  if (Number(row.quality_score || 0) < 70)
    preflight.errors.push({
      severity: "error",
      code: "ocr-quality",
      message: "Overall OCR quality is below the verified-export threshold.",
    });
  preflight.ready = preflight.errors.length === 0;
  const status = preflight.ready ? "ready" : "awaiting_correction";
  const processingStage = preflight.ready ? "verified" : "awaiting_review";
  const rightsTouched = ["rightsBasis", "sourceAttribution", "rightsDeclaration"].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
  let rightsBasis = String(row.rights_basis || "unspecified");
  let sourceAttribution = String(row.source_attribution || "");
  let rightsDeclared = Number(row.rights_declared || 0) === 1;
  let rightsDeclaredBy = row.rights_declared_by ? String(row.rights_declared_by) : null;
  let rightsDeclaredAt = row.rights_declared_at ? String(row.rights_declared_at) : null;
  if (rightsTouched) {
    if (!user || (row.user_id && String(row.user_id) !== user.id)) {
      throw new HttpError(403, "Only the OCR contributor can make the legal sharing declaration.");
    }
    rightsBasis =
      typeof body.rightsBasis === "string" && allowedRightsBases.has(body.rightsBasis)
        ? body.rightsBasis
        : "unspecified";
    sourceAttribution =
      typeof body.sourceAttribution === "string" ? body.sourceAttribution.trim().slice(0, 500) : "";
    if (body.rightsDeclaration !== true)
      throw new HttpError(400, "Confirm that you have the right to publish this OCR document.");
    if (rightsBasis === "unspecified")
      throw new HttpError(400, "Choose the legal basis for sharing this OCR document.");
    rightsDeclared = true;
    rightsDeclaredBy = user.id;
    rightsDeclaredAt = new Date().toISOString();
  }
  const db = getDb();
  db.prepare(
    `
    UPDATE ocr_jobs SET corrected_text=?,metadata_json=?,structure_json=?,revision=?,status=?,processing_stage=?,document_type=?,diagnostics_json=?,rights_basis=?,source_attribution=?,rights_declared=?,rights_declared_by=?,rights_declared_at=?,user_id=COALESCE(user_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?
  `,
  ).run(
    correctedText,
    JSON.stringify(metadata),
    JSON.stringify(structure),
    revision,
    status,
    processingStage,
    inferOcrDocumentType(metadata.docType),
    JSON.stringify({ source: "user_revision", preflightScore: preflight.score }),
    rightsBasis,
    sourceAttribution,
    rightsDeclared ? 1 : 0,
    rightsDeclaredBy,
    rightsDeclaredAt,
    rightsTouched ? (user?.id ?? null) : null,
    id,
  );
  db.prepare(
    `
    INSERT INTO ocr_revisions(job_id,revision,corrected_text,metadata_json,structure_json,note,created_by)
    VALUES(?,?,?,?,?,?,?)
  `,
  ).run(
    id,
    revision,
    correctedText,
    JSON.stringify(metadata),
    JSON.stringify(structure),
    note || "Saved OCR corrections",
    user?.id ?? null,
  );
  persistOcrGeometry(
    id,
    structure,
    jsonArray(row.enhanced_paths_json),
    jsonObject(row.pipeline_json),
    jsonArray(row.source_paths_json),
    jsonArray(row.source_filenames_json),
  );
  db.prepare("DELETE FROM ocr_preflight_results WHERE job_id=? AND revision=?").run(id, revision);
  db.prepare(
    "INSERT INTO ocr_preflight_results(job_id,revision,ready,score,errors_json,warnings_json,checks_json) VALUES(?,?,?,?,?,?,?)",
  ).run(
    id,
    revision,
    preflight.ready ? 1 : 0,
    preflight.score,
    JSON.stringify(preflight.errors),
    JSON.stringify(preflight.warnings),
    JSON.stringify(preflight.checks),
  );
  audit(user?.id ?? null, "ocr.revise", "ocr_job", id, {
    revision,
    status,
    lowConfidenceBlocks: structure.stats.lowConfidenceBlocks,
    rightsDeclared,
  });
  return json({ job: getOcrJobRow(id) });
}

async function restoreOcrRevision(request: Request, id: string, targetRevision: number) {
  const { row, user } = requireOcrJobAccess(request, id);
  if (String(row.status) === "published")
    throw new HttpError(409, "Published OCR jobs cannot be restored.");
  const revisionRow = getDb()
    .prepare(
      `
    SELECT * FROM ocr_revisions WHERE job_id=? AND revision=?
  `,
    )
    .get(id, targetRevision) as Record<string, unknown> | undefined;
  if (!revisionRow) throw new HttpError(404, "OCR revision not found.");
  const structure = normalizeOcrStructure(
    jsonObject(revisionRow.structure_json),
    String(revisionRow.corrected_text || ""),
    Number(row.confidence || 0),
  );
  const nextRevision = Number(row.revision || 1) + 1;
  const metadata = normalizeMetadata(
    jsonObject(revisionRow.metadata_json),
    jsonObject(row.metadata_json),
  );
  const preflight = assessReconstructionQuality(structure, metadata);
  if (Number(row.quality_score || 0) < 70)
    preflight.errors.push({
      severity: "error",
      code: "ocr-quality",
      message: "Overall OCR quality is below the verified-export threshold.",
    });
  preflight.ready = preflight.errors.length === 0;
  const status = preflight.ready ? "ready" : "awaiting_correction";
  const processingStage = preflight.ready ? "verified" : "awaiting_review";
  const note = `Restored revision ${targetRevision}`;
  const db = getDb();
  const correctedText = String(revisionRow.corrected_text || "");
  const metadataJson = String(revisionRow.metadata_json || "{}");
  const structureJson = String(revisionRow.structure_json || '{"version":1,"pages":[]}');
  db.prepare(
    `
    UPDATE ocr_jobs SET corrected_text=?,metadata_json=?,structure_json=?,revision=?,status=?,processing_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `,
  ).run(correctedText, metadataJson, structureJson, nextRevision, status, processingStage, id);
  db.prepare(
    `
    INSERT INTO ocr_revisions(job_id,revision,corrected_text,metadata_json,structure_json,note,created_by)
    VALUES(?,?,?,?,?,?,?)
  `,
  ).run(id, nextRevision, correctedText, metadataJson, structureJson, note, user?.id ?? null);
  persistOcrGeometry(
    id,
    structure,
    jsonArray(row.enhanced_paths_json),
    jsonObject(row.pipeline_json),
    jsonArray(row.source_paths_json),
    jsonArray(row.source_filenames_json),
  );
  db.prepare("DELETE FROM ocr_preflight_results WHERE job_id=? AND revision=?").run(
    id,
    nextRevision,
  );
  db.prepare(
    "INSERT INTO ocr_preflight_results(job_id,revision,ready,score,errors_json,warnings_json,checks_json) VALUES(?,?,?,?,?,?,?)",
  ).run(
    id,
    nextRevision,
    preflight.ready ? 1 : 0,
    preflight.score,
    JSON.stringify(preflight.errors),
    JSON.stringify(preflight.warnings),
    JSON.stringify(preflight.checks),
  );
  audit(user?.id ?? null, "ocr.restore", "ocr_job", id, {
    restoredRevision: targetRevision,
    revision: nextRevision,
  });
  return json({ job: getOcrJobRow(id) });
}

function preflightOcrJob(request: Request, id: string) {
  const { row } = requireOcrJobAccess(request, id);
  if (row.status === "failed" || row.status === "processing")
    throw new HttpError(409, "OCR processing is not complete.");
  const metadata = jsonObject<Record<string, unknown>>(row.metadata_json);
  const structure = normalizeOcrStructure(
    jsonObject(row.structure_json),
    String(row.corrected_text || row.extracted_text || ""),
    Number(row.confidence || 0),
  );
  const result = assessReconstructionQuality(structure, metadata);
  if (Number(row.quality_score || 0) < 70)
    result.errors.push({
      severity: "error",
      code: "ocr-quality",
      message: "Overall OCR quality is below the verified-export threshold.",
    });
  if (!isActualOcrText(String(row.extracted_text || row.corrected_text || "")))
    result.errors.push({
      severity: "error",
      code: "missing-ocr-text",
      message: "No actual OCR source text is available for verification.",
    });
  result.ready = result.errors.length === 0;
  getDb()
    .prepare("DELETE FROM ocr_preflight_results WHERE job_id=? AND revision=?")
    .run(id, Number(row.revision || 1));
  getDb()
    .prepare(
      "INSERT INTO ocr_preflight_results(job_id,revision,ready,score,errors_json,warnings_json,checks_json) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      id,
      Number(row.revision || 1),
      result.ready ? 1 : 0,
      result.score,
      JSON.stringify(result.errors),
      JSON.stringify(result.warnings),
      JSON.stringify(result.checks),
    );
  return json({ preflight: result });
}

async function exportOcrJob(request: Request, id: string, url: URL) {
  const { row } = requireOcrJobAccess(request, id);
  if (row.status === "failed" || row.status === "processing")
    throw new HttpError(409, "OCR processing is not complete.");
  const metadata = jsonObject<Record<string, unknown>>(row.metadata_json);
  const title = String(metadata.title || "OCR Academic Document");
  const structure = normalizeOcrStructure(
    jsonObject(row.structure_json),
    String(row.corrected_text || row.extracted_text || ""),
    Number(row.confidence || 0),
  );
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const requestedMode = url.searchParams.get("mode");
  const layout =
    requestedMode === "searchable-scan" || url.searchParams.get("layout") === "searchable"
      ? "searchable"
      : "clean";
  const templateValue = url.searchParams.get("template");
  const template =
    templateValue && ["auto", "exam", "notes", "compact"].includes(templateValue)
      ? (templateValue as "auto" | "exam" | "notes" | "compact")
      : "auto";
  const enhancedPaths = jsonArray(row.enhanced_paths_json);
  const visualValue = url.searchParams.get("visuals");
  const visualMode =
    visualValue && ["hybrid", "reconstruct", "source"].includes(visualValue)
      ? (visualValue as "hybrid" | "reconstruct" | "source")
      : requestedMode === "clean"
        ? "reconstruct"
        : "hybrid";
  const reconstructionOptions = {
    template,
    preserveSourcePages: url.searchParams.get("sourcePages") === "preserve",
    preserveAnswerSpace: url.searchParams.get("answerSpace") !== "remove",
    showReviewHighlights: url.searchParams.get("reviewHighlights") === "show",
    draft: url.searchParams.get("final") !== "1",
    sourceImagePaths: enhancedPaths,
    visualMode,
  };
  const finalExport =
    url.searchParams.get("final") === "1" || url.searchParams.get("status") === "verified";
  const preflight = assessReconstructionQuality(structure, metadata);
  const bytes =
    format === "docx"
      ? await createStructuredDocx(title, structure, reconstructionOptions)
      : layout === "searchable"
        ? await createSearchableScanPdf(title, structure, enhancedPaths)
        : await createStructuredPdf(title, structure, metadata, reconstructionOptions);
  await mkdir(path.join(dataDir, "exports"), { recursive: true });
  const exportPath = path.join(
    dataDir,
    "exports",
    `${id}-revision-${Number(row.revision || 1)}-${finalExport ? "verified" : "draft"}.${format}`,
  );
  await writeFile(exportPath, bytes);
  getDb()
    .prepare(
      "INSERT INTO ocr_exports(id,job_id,revision,format,mode,path,verified) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      id,
      Number(row.revision || 1),
      format,
      layout === "searchable" ? "searchable" : visualMode,
      exportPath,
      finalExport ? 1 : 0,
    );
  console.info("[EduSearch OCR] export", {
    jobId: id,
    revision: Number(row.revision || 1),
    format,
    verified: finalExport,
    path: exportPath,
    preflightScore: preflight.score,
  });
  return new Response(arrayBufferBody(bytes), {
    headers: {
      "content-type":
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
      "content-disposition": `attachment; filename="${slugify(title)}${finalExport ? "-verified-final" : format === "pdf" && layout === "searchable" ? "-searchable-scan" : "-ocr-draft"}.${format}"`,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
    },
  });
}

async function publishOcrJob(request: Request, id: string) {
  const user = sessionFromRequest(request);
  const { row } = requireOcrJobAccess(request, id, user);
  if (row.published_document_id)
    throw new HttpError(409, "This OCR job has already been published.");
  const metadata = normalizeMetadata(jsonObject(row.metadata_json), {});
  const structure = normalizeOcrStructure(
    jsonObject(row.structure_json),
    String(row.corrected_text || row.extracted_text || ""),
    Number(row.confidence || 0),
  );
  const text = ocrStructureToText(structure).trim();
  const preflight = assessReconstructionQuality(structure, metadata);
  if (!isActualOcrText(text) || Number(row.quality_score || 0) < 70 || !preflight.ready)
    throw new HttpError(
      422,
      "Publication blocked until OCR preflight passes with verified source text.",
      {
        stage: "awaiting_review",
        preflight,
      },
    );
  const documentId = uniqueDocumentId(metadata.title);
  const pdfBytes = await createStructuredPdf(metadata.title, structure, metadata, {
    template: "auto",
    preserveAnswerSpace: true,
    showReviewHighlights: false,
    draft: false,
    sourceImagePaths: jsonArray(row.enhanced_paths_json),
    visualMode: "hybrid",
  });
  const docxBytes = await createStructuredDocx(metadata.title, structure, {
    template: "auto",
    preserveAnswerSpace: true,
    draft: false,
    sourceImagePaths: jsonArray(row.enhanced_paths_json),
    visualMode: "hybrid",
  });
  const storagePath = path.join(dataDir, "uploads", `${documentId}.pdf`);
  const docxStoragePath = path.join(dataDir, "uploads", `${documentId}.docx`);
  await writeFile(storagePath, pdfBytes);
  await writeFile(docxStoragePath, docxBytes);
  const status = user?.role === "admin" ? "published" : "awaiting_review";
  const contributorId = row.user_id ? String(row.user_id) : (user?.id ?? null);
  const rightsBasis = String(row.rights_basis || "public_domain");
  const sourceAttribution = String(row.source_attribution || "");
  getDb()
    .prepare(
      `
    INSERT INTO documents(
      id,title,subject,topics_json,doc_type,year,level,language,file_type,pages,size_bytes,institution,author,
      upload_source,description,keywords_json,original_filename,storage_path,extracted_text,status,uploaded_by,
      original_source_path,docx_storage_path,structure_json,ocr_job_id,rights_basis,source_attribution,rights_status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    )
    .run(
      documentId,
      metadata.title,
      metadata.subject,
      JSON.stringify(metadata.topics),
      metadata.docType,
      metadata.year,
      metadata.level,
      metadata.language,
      "PDF",
      Math.max(1, structure.stats.pages),
      pdfBytes.length,
      metadata.institution || null,
      metadata.author || null,
      "ocr-scanner",
      metadata.description,
      JSON.stringify(metadata.keywords),
      `${slugify(metadata.title)}.pdf`,
      storagePath,
      text,
      status,
      contributorId,
      String(row.source_path),
      docxStoragePath,
      JSON.stringify(structure),
      id,
      rightsBasis,
      sourceAttribution,
      "clear",
    );
  const documentDb = getDb();
  const insertDocumentPage = documentDb.prepare(
    "INSERT INTO document_pages(document_id,page_number,source_path,pdf_path,extracted_text,width,height) VALUES(?,?,?,?,?,?,?)",
  );
  const enhancedPaths = jsonArray(row.enhanced_paths_json);
  for (const page of structure.pages)
    insertDocumentPage.run(
      documentId,
      page.pageNumber,
      enhancedPaths[page.pageNumber - 1] || String(row.source_path),
      storagePath,
      page.blocks.map((block) => block.text).join("\n\n"),
      page.width,
      page.height,
    );
  documentDb
    .prepare(
      "INSERT INTO ocr_exports(id,job_id,revision,format,mode,path,verified) VALUES(?,?,?,?,?,?,1)",
    )
    .run(randomUUID(), id, Number(row.revision || 1), "pdf", "hybrid", storagePath);
  documentDb
    .prepare(
      "UPDATE ocr_jobs SET status='published',processing_stage='published',progress=100,current_stage='Published',published_document_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(documentId, id);
  if (status === "published") {
    refreshDocumentFts(documentId);
    notifyTopicFollowers(documentId, {
      title: metadata.title,
      subject: metadata.subject,
      topics_json: JSON.stringify(metadata.topics),
      uploaded_by: contributorId,
    });
  }
  if (contributorId && contributorId !== user?.id) {
    createNotification(
      contributorId,
      "ocr_published",
      "OCR document published",
      `${metadata.title} was approved and published from the OCR review queue.`,
      `/document/${documentId}`,
    );
  }
  audit(user?.id ?? null, "ocr.publish", "document", documentId, {
    ocrJobId: id,
    status,
    revision: Number(row.revision || 1),
    structure: structure.stats,
    rightsBasis,
    sourceAttribution: Boolean(sourceAttribution),
  });
  return json({ documentId, status }, 201);
}

function adminOcrJobs(request: Request, url: URL) {
  requireAdmin(request);
  const status = url.searchParams.get("status") || "awaiting_correction";
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const allowed = new Set([
    "processing",
    "awaiting_correction",
    "ready",
    "published",
    "failed",
    "all",
  ]);
  if (!allowed.has(status)) throw new HttpError(400, "Unsupported OCR status filter.");
  const where = ["1=1"];
  const params: Array<string | number> = [];
  if (status !== "all") {
    where.push("o.status=?");
    params.push(status);
  }
  if (query) {
    where.push(
      "(lower(o.original_filename) LIKE lower(?) OR lower(COALESCE(u.name,'')) LIKE lower(?) OR lower(COALESCE(u.email,'')) LIKE lower(?))",
    );
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const rows = getDb()
    .prepare(
      `
    SELECT o.*,u.name AS user_name,u.email AS user_email
    FROM ocr_jobs o LEFT JOIN users u ON u.id=o.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY datetime(o.updated_at) DESC LIMIT 150
  `,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return json({
    jobs: rows.map((row) => ({
      ...mapOcrJob(row),
      userName: row.user_name ? String(row.user_name) : "Anonymous",
      userEmail: row.user_email ? String(row.user_email) : null,
    })),
  });
}

function requireOcrJobAccess(request: Request, id: string, suppliedUser?: SessionUser | null) {
  const user = suppliedUser === undefined ? sessionFromRequest(request) : suppliedUser;
  const row = getDb().prepare("SELECT * FROM ocr_jobs WHERE id=?").get(id) as
    Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "OCR job not found.");
  return { row, user };
}

async function servePrivateFile(filePath: string, filename: string) {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new HttpError(404, "OCR source file is no longer available.");
  }
  return new Response(arrayBufferBody(bytes), {
    headers: {
      "content-type": contentTypeFromName(filename),
      "content-disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "-")}"`,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
    },
  });
}

function savedDocuments(request: Request) {
  const user = requireUser(request);
  const access = documentAccess(user, "d");
  const rows = getDb()
    .prepare(
      `
    SELECT d.* FROM saved_documents s JOIN documents d ON d.id=s.document_id
    WHERE s.user_id=? AND d.status='published' AND ${access.sql} ORDER BY datetime(s.created_at) DESC
  `,
    )
    .all(user.id, ...access.params) as Array<Record<string, unknown>>;
  const collectionRows = getDb()
    .prepare(
      `
    SELECT c.id,c.name,COUNT(cd.document_id) AS count
    FROM collections c LEFT JOIN collection_documents cd ON cd.collection_id=c.id
    WHERE c.user_id=? GROUP BY c.id ORDER BY c.name
  `,
    )
    .all(user.id);
  return json({
    documents: rows.map((row) => mapDocument(row, user)),
    collections: collectionRows,
  });
}

function saveDocument(request: Request, documentId: string) {
  const user = requireUser(request);
  ensurePublishedDocument(documentId, user);
  getDb()
    .prepare("INSERT OR IGNORE INTO saved_documents(user_id,document_id) VALUES(?,?)")
    .run(user.id, documentId);
  return json({ saved: true });
}

function unsaveDocument(request: Request, documentId: string) {
  const user = requireUser(request);
  getDb()
    .prepare("DELETE FROM saved_documents WHERE user_id=? AND document_id=?")
    .run(user.id, documentId);
  return json({ saved: false });
}

function recommendations(request: Request, url: URL) {
  const user = requireUser(request);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 12), 1), 40);
  return json({
    documents: buildRecommendations(user, limit).map((row) => mapDocument(row, user)),
  });
}

function buildRecommendations(user: SessionUser, limit: number) {
  const db = getDb();
  const interests = db
    .prepare(
      `
    SELECT value, SUM(weight) AS weight FROM (
      SELECT lower(d.subject) AS value, 5 AS weight
      FROM saved_documents s JOIN documents d ON d.id=s.document_id
      WHERE s.user_id=?
      UNION ALL
      SELECT lower(d.subject) AS value, 4 AS weight
      FROM download_logs l JOIN documents d ON d.id=l.document_id
      WHERE l.user_id=? AND datetime(l.created_at) > datetime('now','-180 days')
      UNION ALL
      SELECT lower(topic_name) AS value, 6 AS weight FROM followed_topics WHERE user_id=?
      UNION ALL
      SELECT lower(query) AS value, 2 AS weight
      FROM search_logs WHERE user_id=? AND datetime(created_at) > datetime('now','-90 days') AND result_count > 0
    ) WHERE value <> '' GROUP BY value ORDER BY weight DESC LIMIT 20
  `,
    )
    .all(user.id, user.id, user.id, user.id) as Array<{ value: string; weight: number }>;

  const access = documentAccess(user, "d");
  const all = db
    .prepare(
      `
    SELECT d.* FROM documents d
    WHERE d.status='published' AND ${access.sql}
      AND d.id NOT IN (SELECT document_id FROM saved_documents WHERE user_id=?)
    ORDER BY d.downloads DESC, d.rating DESC, datetime(d.created_at) DESC
    LIMIT 250
  `,
    )
    .all(...access.params, user.id) as Array<Record<string, unknown>>;
  if (!interests.length) return all.slice(0, limit);

  return all
    .map((row) => {
      const haystack = normalize(
        [
          row.subject,
          row.title,
          row.description,
          jsonArray(row.topics_json).join(" "),
          jsonArray(row.keywords_json).join(" "),
        ].join(" "),
      );
      const score = interests.reduce(
        (total, interest) =>
          total + (haystack.includes(normalize(interest.value)) ? Number(interest.weight) : 0),
        0,
      );
      return { row, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.row.downloads || 0) - Number(left.row.downloads || 0),
    )
    .filter((entry, index) => entry.score > 0 || index < limit)
    .slice(0, limit)
    .map((entry) => entry.row);
}

function followedTopics(request: Request) {
  const user = requireUser(request);
  const rows = getDb()
    .prepare(
      "SELECT topic_name AS topicName,created_at AS createdAt FROM followed_topics WHERE user_id=? ORDER BY topic_name",
    )
    .all(user.id);
  return json({ topics: rows });
}

async function followTopic(request: Request) {
  const user = requireUser(request);
  const body = await readJson(request);
  const requestedName = requiredString(body.topicName, "Topic name").slice(0, 120);
  const db = getDb();
  const canonical =
    (
      db
        .prepare("SELECT name FROM topics WHERE lower(name)=lower(?) LIMIT 1")
        .get(requestedName) as { name: string } | undefined
    )?.name ?? requestedName;
  db.prepare("DELETE FROM followed_topics WHERE user_id=? AND lower(topic_name)=lower(?)").run(
    user.id,
    canonical,
  );
  db.prepare("INSERT INTO followed_topics(user_id,topic_name) VALUES(?,?)").run(user.id, canonical);
  return json({ following: true, topicName: canonical });
}

function unfollowTopic(request: Request, url: URL) {
  const user = requireUser(request);
  const topicName = requiredString(url.searchParams.get("topicName"), "Topic name").slice(0, 120);
  getDb()
    .prepare("DELETE FROM followed_topics WHERE user_id=? AND lower(topic_name)=lower(?)")
    .run(user.id, topicName);
  return json({ following: false, topicName });
}

async function rateDocument(request: Request, documentId: string) {
  const user = requireUser(request);
  ensurePublishedDocument(documentId, user);
  const body = await readJson(request);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new HttpError(400, "Rating must be an integer from 1 to 5.");
  const db = getDb();
  db.prepare(
    `
    INSERT INTO document_ratings(user_id,document_id,rating) VALUES(?,?,?)
    ON CONFLICT(user_id,document_id) DO UPDATE SET rating=excluded.rating,updated_at=CURRENT_TIMESTAMP
  `,
  ).run(user.id, documentId, rating);
  const stats = db
    .prepare(
      "SELECT COUNT(*) AS count,AVG(rating) AS average FROM document_ratings WHERE document_id=?",
    )
    .get(documentId) as { count: number; average: number };
  db.prepare("UPDATE documents SET rating=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(
    Number(stats.average || 0),
    documentId,
  );
  return json({
    rating: Number(stats.average || 0),
    ratingCount: Number(stats.count),
    userRating: rating,
  });
}

async function reportDocument(request: Request, documentId: string) {
  const user = sessionFromRequest(request);
  ensurePublishedDocument(documentId, user);
  const body = await readJson(request);
  const allowedReasons = new Set([
    "copyright",
    "wrong_document",
    "missing_pages",
    "poor_quality",
    "incorrect_ocr",
    "personal_information",
    "malware",
    "other",
  ]);
  const reason = requiredString(body.reason, "Report reason");
  if (!allowedReasons.has(reason)) throw new HttpError(400, "Unsupported report reason.");
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO document_reports(id,document_id,user_id,reason,details) VALUES(?,?,?,?,?)",
    )
    .run(id, documentId, user?.id ?? null, reason, details);
  return json({ reportId: id, status: "open" }, 201);
}

function notifications(request: Request) {
  const user = requireUser(request);
  const rows = getDb()
    .prepare(
      `
    SELECT id,type,title,message,link,read_at AS readAt,created_at AS createdAt
    FROM notifications WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 50
  `,
    )
    .all(user.id);
  const unread = Number(
    (
      getDb()
        .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL")
        .get(user.id) as { count: number }
    ).count,
  );
  return json({ unread, notifications: rows });
}

function markNotificationRead(request: Request, id: string) {
  const user = requireUser(request);
  const result = getDb()
    .prepare(
      "UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND user_id=?",
    )
    .run(id, user.id);
  if (!result.changes) throw new HttpError(404, "Notification not found.");
  return json({ read: true });
}

function markAllNotificationsRead(request: Request) {
  const user = requireUser(request);
  getDb()
    .prepare("UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE user_id=?")
    .run(user.id);
  return json({ read: true });
}

function collections(request: Request) {
  const user = requireUser(request);
  const rows = getDb()
    .prepare(
      `
    SELECT c.id,c.name,COUNT(cd.document_id) AS count
    FROM collections c LEFT JOIN collection_documents cd ON cd.collection_id=c.id
    WHERE c.user_id=? GROUP BY c.id ORDER BY c.name
  `,
    )
    .all(user.id);
  return json({ collections: rows });
}

async function createCollection(request: Request) {
  const user = requireUser(request);
  const body = await readJson(request);
  const name = requiredString(body.name, "Collection name").slice(0, 100);
  if (
    getDb()
      .prepare("SELECT 1 FROM collections WHERE user_id=? AND lower(name)=lower(?)")
      .get(user.id, name)
  ) {
    throw new HttpError(409, "You already have a collection with that name.");
  }
  const id = randomUUID();
  getDb().prepare("INSERT INTO collections(id,user_id,name) VALUES(?,?,?)").run(id, user.id, name);
  return json({ collection: { id, name, count: 0 } }, 201);
}

function collectionDetail(request: Request, collectionId: string) {
  const user = requireUser(request);
  const collection = getDb()
    .prepare("SELECT id,name,created_at AS createdAt FROM collections WHERE id=? AND user_id=?")
    .get(collectionId, user.id) as { id: string; name: string; createdAt: string } | undefined;
  if (!collection) throw new HttpError(404, "Collection not found.");
  const access = documentAccess(user, "d");
  const documents = getDb()
    .prepare(
      `
    SELECT d.* FROM collection_documents cd JOIN documents d ON d.id=cd.document_id
    WHERE cd.collection_id=? AND d.status='published' AND ${access.sql}
    ORDER BY datetime(cd.created_at) DESC
  `,
    )
    .all(collectionId, ...access.params) as Array<Record<string, unknown>>;
  return json({
    collection: { ...collection, count: documents.length },
    documents: documents.map((row) => mapDocument(row, user)),
  });
}

async function updateCollection(request: Request, collectionId: string) {
  const user = requireUser(request);
  requireOwnedCollection(collectionId, user.id);
  const body = await readJson(request);
  const name = requiredString(body.name, "Collection name").slice(0, 100);
  if (
    getDb()
      .prepare("SELECT 1 FROM collections WHERE user_id=? AND lower(name)=lower(?) AND id<>?")
      .get(user.id, name, collectionId)
  ) {
    throw new HttpError(409, "You already have a collection with that name.");
  }
  getDb()
    .prepare("UPDATE collections SET name=? WHERE id=? AND user_id=?")
    .run(name, collectionId, user.id);
  return json({ collection: { id: collectionId, name } });
}

function deleteCollection(request: Request, collectionId: string) {
  const user = requireUser(request);
  requireOwnedCollection(collectionId, user.id);
  getDb().prepare("DELETE FROM collections WHERE id=? AND user_id=?").run(collectionId, user.id);
  return json({ deleted: true });
}

async function addDocumentToCollection(request: Request, collectionId: string) {
  const user = requireUser(request);
  const body = await readJson(request);
  const documentId = requiredString(body.documentId, "Document ID");
  requireOwnedCollection(collectionId, user.id);
  ensurePublishedDocument(documentId, user);
  getDb()
    .prepare("INSERT OR IGNORE INTO collection_documents(collection_id,document_id) VALUES(?,?)")
    .run(collectionId, documentId);
  return json({ added: true });
}

async function removeDocumentFromCollection(request: Request, collectionId: string) {
  const user = requireUser(request);
  const body = await readJson(request);
  const documentId = requiredString(body.documentId, "Document ID");
  requireOwnedCollection(collectionId, user.id);
  getDb()
    .prepare("DELETE FROM collection_documents WHERE collection_id=? AND document_id=?")
    .run(collectionId, documentId);
  return json({ added: false });
}

function requireOwnedCollection(collectionId: string, userId: string) {
  const collection = getDb()
    .prepare("SELECT id FROM collections WHERE id=? AND user_id=?")
    .get(collectionId, userId);
  if (!collection) throw new HttpError(404, "Collection not found.");
}

function libraries(request: Request) {
  const user = sessionFromRequest(request);
  const db = getDb();
  let rows: Array<Record<string, unknown>>;
  if (user?.role === "admin") {
    rows = db
      .prepare(
        `
      SELECT l.*,
        (SELECT COUNT(*) FROM library_members lm WHERE lm.library_id=l.id) AS member_count,
        (SELECT COUNT(*) FROM library_documents ld JOIN documents d ON d.id=ld.document_id WHERE ld.library_id=l.id AND d.status='published') AS document_count
      FROM libraries l ORDER BY datetime(l.created_at) DESC
    `,
      )
      .all() as Array<Record<string, unknown>>;
  } else if (user) {
    rows = db
      .prepare(
        `
      SELECT l.*,
        (SELECT role FROM library_members lm WHERE lm.library_id=l.id AND lm.user_id=?) AS member_role,
        (SELECT COUNT(*) FROM library_members lm WHERE lm.library_id=l.id) AS member_count,
        (SELECT COUNT(*) FROM library_documents ld JOIN documents d ON d.id=ld.document_id
          WHERE ld.library_id=l.id AND d.status='published'
            AND (d.visibility IS NULL OR d.visibility='public' OR EXISTS (
              SELECT 1 FROM library_members count_member
              WHERE count_member.library_id=l.id AND count_member.user_id=?
            ))) AS document_count
      FROM libraries l
      WHERE l.visibility='public' OR EXISTS (SELECT 1 FROM library_members lm WHERE lm.library_id=l.id AND lm.user_id=?)
      ORDER BY CASE WHEN EXISTS (SELECT 1 FROM library_members lm WHERE lm.library_id=l.id AND lm.user_id=?) THEN 0 ELSE 1 END, datetime(l.created_at) DESC
    `,
      )
      .all(user.id, user.id, user.id, user.id) as Array<Record<string, unknown>>;
  } else {
    rows = db
      .prepare(
        `
      SELECT l.*,
        NULL AS member_role,
        (SELECT COUNT(*) FROM library_members lm WHERE lm.library_id=l.id) AS member_count,
        (SELECT COUNT(*) FROM library_documents ld JOIN documents d ON d.id=ld.document_id
          WHERE ld.library_id=l.id AND d.status='published' AND (d.visibility IS NULL OR d.visibility='public')) AS document_count
      FROM libraries l WHERE l.visibility='public' ORDER BY datetime(l.created_at) DESC
    `,
      )
      .all() as Array<Record<string, unknown>>;
  }
  return json({ libraries: rows.map((row) => mapLibrary(row, user)) });
}

async function createLibrary(request: Request) {
  const user = requireUser(request);
  const body = await readJson(request);
  const name = requiredString(body.name, "Library name").slice(0, 140);
  const institution =
    typeof body.institution === "string" ? body.institution.trim().slice(0, 180) : "";
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
  const visibility = body.visibility === "public" ? "public" : "private";
  const id = randomUUID();
  const slug = uniqueLibrarySlug(name);
  const joinCode = generateUniqueJoinCode();
  const db = getDb();
  db.prepare(
    `
    INSERT INTO libraries(id,name,slug,institution,description,visibility,owner_user_id,join_code_hash,join_code_hint)
    VALUES(?,?,?,?,?,?,?,?,?)
  `,
  ).run(
    id,
    name,
    slug,
    institution,
    description,
    visibility,
    user.id,
    hashJoinCode(joinCode),
    joinCode.slice(-4),
  );
  db.prepare("INSERT INTO library_members(library_id,user_id,role) VALUES(?,?, 'owner')").run(
    id,
    user.id,
  );
  audit(user.id, "library.create", "library", id, { name, visibility, institution });
  const row = db
    .prepare(
      "SELECT *,1 AS member_count,0 AS document_count,'owner' AS member_role FROM libraries WHERE id=?",
    )
    .get(id) as Record<string, unknown>;
  return json({ library: mapLibrary(row, user), joinCode }, 201);
}

async function joinLibrary(request: Request) {
  const user = requireUser(request);
  const body = await readJson(request);
  const joinCode = requiredString(body.joinCode, "Join code");
  const db = getDb();
  const library = db
    .prepare("SELECT * FROM libraries WHERE join_code_hash=?")
    .get(hashJoinCode(joinCode)) as Record<string, unknown> | undefined;
  if (!library) throw new HttpError(404, "That library join code is invalid.");
  db.prepare(
    "INSERT OR IGNORE INTO library_members(library_id,user_id,role) VALUES(?,?, 'viewer')",
  ).run(String(library.id), user.id);
  if (String(library.owner_user_id) !== user.id) {
    createNotification(
      String(library.owner_user_id),
      "library_member_joined",
      "New library member",
      `${user.name} joined ${String(library.name)}.`,
      "/libraries",
    );
  }
  audit(user.id, "library.join", "library", String(library.id), {});
  return json({ joined: true, libraryId: String(library.id) });
}

function libraryDetail(request: Request, id: string) {
  const user = sessionFromRequest(request);
  const access = requireLibraryAccess(id, user);
  const db = getDb();
  const canManage = user?.role === "admin" || access.role === "owner" || access.role === "editor";
  const documentPolicy = documentAccess(user, "d");
  const libraryDocumentPolicy = canManage
    ? {
        sql: "d.status<>'archived' AND (d.visibility IS NULL OR d.visibility='public' OR d.library_id=?)",
        params: [id] as Array<string | number>,
      }
    : { sql: `d.status='published' AND ${documentPolicy.sql}`, params: documentPolicy.params };
  const rows = db
    .prepare(
      `
    SELECT DISTINCT d.* FROM documents d
    LEFT JOIN library_documents ld ON ld.document_id=d.id
    WHERE (ld.library_id=? OR d.library_id=?) AND ${libraryDocumentPolicy.sql}
    ORDER BY datetime(d.created_at) DESC
  `,
    )
    .all(id, id, ...libraryDocumentPolicy.params) as Array<Record<string, unknown>>;
  const members = canManage
    ? db
        .prepare(
          `
        SELECT u.id,u.name,u.email,lm.role,lm.joined_at AS joinedAt
        FROM library_members lm JOIN users u ON u.id=lm.user_id
        WHERE lm.library_id=? ORDER BY CASE lm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,u.name
      `,
        )
        .all(id)
    : [];
  const countPolicy = canManage
    ? {
        sql: "(d.visibility IS NULL OR d.visibility='public' OR d.library_id=?)",
        params: [id] as Array<string | number>,
      }
    : documentPolicy;
  const counts = db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM library_members WHERE library_id=?) AS member_count,
      (SELECT COUNT(*) FROM library_documents ld JOIN documents d ON d.id=ld.document_id
        WHERE ld.library_id=? AND d.status='published' AND ${countPolicy.sql}) AS document_count
  `,
    )
    .get(id, id, ...countPolicy.params) as Record<string, unknown>;
  const row = { ...access.library, ...counts, member_role: access.role };
  return json({
    library: mapLibrary(row, user),
    documents: rows.map((item) => mapDocument(item, user, canManage)),
    members,
    canManage,
  });
}

async function updateLibrary(request: Request, id: string) {
  const user = requireUser(request);
  const access = requireLibraryOwner(id, user);
  const body = await readJson(request);
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 140)
      : String(access.library.name);
  const institution =
    typeof body.institution === "string"
      ? body.institution.trim().slice(0, 180)
      : String(access.library.institution || "");
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, 2000)
      : String(access.library.description || "");
  const visibility =
    body.visibility === "public" || body.visibility === "private"
      ? body.visibility
      : String(access.library.visibility);
  getDb()
    .prepare(
      "UPDATE libraries SET name=?,institution=?,description=?,visibility=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(name, institution, description, visibility, id);
  audit(user.id, "library.update", "library", id, { name, visibility });
  return libraryDetail(request, id);
}

function deleteLibrary(request: Request, id: string) {
  const user = requireUser(request);
  const access = requireLibraryOwner(id, user);
  const db = getDb();
  const privateDocuments = db
    .prepare("SELECT id FROM documents WHERE library_id=? AND visibility='library'")
    .all(id) as Array<{ id: string }>;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE documents SET status='archived',visibility='public',library_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE library_id=? AND visibility='library'",
    ).run(id);
    db.prepare("DELETE FROM libraries WHERE id=?").run(id);
    audit(user.id, "library.delete", "library", id, {
      name: String(access.library.name),
      archivedDocuments: privateDocuments.length,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  privateDocuments.forEach((document) => refreshDocumentFts(document.id));
  return json({ deleted: true, archivedDocuments: privateDocuments.length });
}

function regenerateLibraryJoinCode(request: Request, id: string) {
  const user = requireUser(request);
  requireLibraryOwner(id, user);
  const joinCode = generateUniqueJoinCode();
  getDb()
    .prepare(
      "UPDATE libraries SET join_code_hash=?,join_code_hint=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(hashJoinCode(joinCode), joinCode.slice(-4), id);
  audit(user.id, "library.join_code.rotate", "library", id, {});
  return json({ joinCode });
}

async function addLibraryDocument(request: Request, id: string) {
  const user = requireUser(request);
  requireLibraryManager(id, user);
  const body = await readJson(request);
  const documentId = requiredString(body.documentId, "Document ID");
  ensurePublishedDocument(documentId, user);
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO library_documents(library_id,document_id,added_by) VALUES(?,?,?)",
  ).run(id, documentId, user.id);
  if (body.makePrivate === true) {
    db.prepare("DELETE FROM library_documents WHERE document_id=? AND library_id<>?").run(
      documentId,
      id,
    );
    db.prepare(
      "UPDATE documents SET visibility='library',library_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(id, documentId);
  }
  audit(user.id, "library.document.add", "document", documentId, {
    libraryId: id,
    makePrivate: body.makePrivate === true,
  });
  return json({ added: true });
}

async function removeLibraryDocument(request: Request, id: string) {
  const user = requireUser(request);
  requireLibraryManager(id, user);
  const body = await readJson(request);
  const documentId = requiredString(body.documentId, "Document ID");
  const db = getDb();
  const document = db
    .prepare("SELECT visibility,library_id,status,uploaded_by,title FROM documents WHERE id=?")
    .get(documentId) as Record<string, unknown> | undefined;
  if (!document) throw new HttpError(404, "Document not found.");
  db.prepare("DELETE FROM library_documents WHERE library_id=? AND document_id=?").run(
    id,
    documentId,
  );
  if (String(document.visibility) === "library" && String(document.library_id) === id) {
    db.prepare(
      "UPDATE documents SET status='approved',visibility='public',library_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(documentId);
    refreshDocumentFts(documentId);
    if (document.uploaded_by) {
      createNotification(
        String(document.uploaded_by),
        "library_document_removed",
        "Document removed from library",
        `${String(document.title || "Your document")} was removed from its private library and returned to an unpublished state.`,
        "/saved",
      );
    }
  }
  audit(user.id, "library.document.remove", "document", documentId, { libraryId: id });
  return json({ added: false });
}

async function updateLibraryMember(request: Request, libraryId: string, memberId: string) {
  const user = requireUser(request);
  const access = requireLibraryOwner(libraryId, user);
  const body = await readJson(request);
  const role = requiredString(body.role, "Member role");
  if (role !== "editor" && role !== "viewer")
    throw new HttpError(400, "Member role must be editor or viewer.");
  if (String(access.library.owner_user_id) === memberId)
    throw new HttpError(400, "The library owner role cannot be changed.");
  const db = getDb();
  const result = db
    .prepare("UPDATE library_members SET role=? WHERE library_id=? AND user_id=?")
    .run(role, libraryId, memberId);
  if (!result.changes) throw new HttpError(404, "Library member not found.");
  createNotification(
    memberId,
    "library_role_changed",
    "Library role updated",
    `Your role in ${String(access.library.name)} is now ${role}.`,
    "/libraries",
  );
  audit(user.id, "library.member.role", "library", libraryId, { memberId, role });
  return json({ updated: true, role });
}

function removeLibraryMember(request: Request, libraryId: string, memberId: string) {
  const user = requireUser(request);
  const access = requireLibraryOwner(libraryId, user);
  if (String(access.library.owner_user_id) === memberId)
    throw new HttpError(400, "The library owner cannot be removed.");
  const result = getDb()
    .prepare("DELETE FROM library_members WHERE library_id=? AND user_id=?")
    .run(libraryId, memberId);
  if (!result.changes) throw new HttpError(404, "Library member not found.");
  createNotification(
    memberId,
    "library_membership_removed",
    "Library membership removed",
    `Your access to ${String(access.library.name)} was removed.`,
    "/libraries",
  );
  audit(user.id, "library.member.remove", "library", libraryId, { memberId });
  return json({ removed: true });
}

function adminAudit(request: Request, url: URL) {
  requireAdmin(request);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
  const rows = getDb()
    .prepare(
      `
    SELECT a.id,a.action,a.entity_type AS entityType,a.entity_id AS entityId,a.details_json AS detailsJson,a.created_at AS createdAt,
           u.name AS userName,u.email AS userEmail
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    ORDER BY datetime(a.created_at) DESC LIMIT ?
  `,
    )
    .all(limit) as Array<Record<string, unknown>>;
  return json({ logs: rows.map((row) => ({ ...row, details: jsonObject(row.detailsJson) })) });
}

function adminUsers(request: Request, url: URL) {
  requireAdmin(request);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const role = url.searchParams.get("role");
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query) {
    where.push("(lower(u.name) LIKE lower(?) OR lower(u.email) LIKE lower(?))");
    params.push(`%${query}%`, `%${query}%`);
  }
  if (role === "admin" || role === "user") {
    where.push("u.role=?");
    params.push(role);
  }
  const rows = getDb()
    .prepare(
      `
    SELECT u.id,u.name,u.email,u.role,u.created_at AS createdAt,
      (SELECT COUNT(*) FROM documents d WHERE d.uploaded_by=u.id) AS documentCount,
      (SELECT COUNT(*) FROM libraries l WHERE l.owner_user_id=u.id) AS ownedLibraryCount,
      (SELECT MAX(created_at) FROM sessions s WHERE s.user_id=u.id) AS lastSessionAt
    FROM users u ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END,lower(u.name) LIMIT 250
  `,
    )
    .all(...params);
  return json({ users: rows });
}

async function createAdminUser(request: Request) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const name = requiredString(body.name, "Full name").slice(0, 120);
  const email = validEmail(body.email);
  const password = requiredString(body.password, "Temporary password");
  if (password.length < 8) throw new HttpError(400, "Password must contain at least 8 characters.");
  const role = body.role === "admin" ? "admin" : "user";
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
    throw new HttpError(409, "An account already uses this email address.");
  const id = randomUUID();
  db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)").run(
    id,
    name,
    email,
    await hashPassword(password),
    role,
  );
  createDefaultCollections(id);
  createNotification(
    id,
    "account_created",
    "Your EduSearch AI account is ready",
    `An administrator created your ${role} account. Sign in and change the temporary password with an administrator.`,
    "/login",
  );
  audit(admin.id, "user.create", "user", id, { name, email, role });
  return json({ user: { id, name, email, role, documentCount: 0, ownedLibraryCount: 0 } }, 201);
}

async function updateAdminUser(request: Request, userId: string) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const db = getDb();
  const current = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(userId) as
    { id: string; name: string; email: string; role: string } | undefined;
  if (!current) throw new HttpError(404, "User not found.");
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : current.name;
  const email = body.email === undefined ? current.email : validEmail(body.email);
  const role =
    body.role === undefined
      ? current.role
      : body.role === "admin"
        ? "admin"
        : body.role === "user"
          ? "user"
          : null;
  if (!role) throw new HttpError(400, "Role must be admin or user.");
  if (userId === admin.id && role !== "admin")
    throw new HttpError(400, "You cannot remove your own administrator access.");
  if (current.role === "admin" && role !== "admin" && adminCount() <= 1)
    throw new HttpError(400, "At least one administrator must remain.");
  if (db.prepare("SELECT 1 FROM users WHERE email=? AND id<>?").get(email, userId))
    throw new HttpError(409, "An account already uses this email address.");
  const password = typeof body.password === "string" ? body.password : "";
  if (password && password.length < 8)
    throw new HttpError(400, "Password must contain at least 8 characters.");
  db.prepare("UPDATE users SET name=?,email=?,role=? WHERE id=?").run(name, email, role, userId);
  if (password)
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
      await hashPassword(password),
      userId,
    );
  if (password || role !== current.role)
    db.prepare(
      "DELETE FROM sessions WHERE user_id=? AND id NOT IN (SELECT id FROM sessions WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT ?)",
    ).run(userId, userId, userId === admin.id ? 1 : 0);
  if (role !== current.role)
    createNotification(
      userId,
      "account_role_changed",
      "Account role changed",
      `Your account role is now ${role}.`,
      "/",
    );
  audit(admin.id, "user.update", "user", userId, {
    name,
    email,
    role,
    passwordReset: Boolean(password),
  });
  return json({ user: { id: userId, name, email, role } });
}

function deleteAdminUser(request: Request, userId: string) {
  const admin = requireAdmin(request);
  if (userId === admin.id)
    throw new HttpError(400, "You cannot delete your own account from the admin dashboard.");
  const db = getDb();
  const current = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(userId) as
    { id: string; name: string; email: string; role: string } | undefined;
  if (!current) throw new HttpError(404, "User not found.");
  if (current.role === "admin" && adminCount() <= 1)
    throw new HttpError(400, "At least one administrator must remain.");
  const ownedLibraries = db
    .prepare("SELECT id FROM libraries WHERE owner_user_id=?")
    .all(userId) as Array<{ id: string }>;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const library of ownedLibraries) {
      db.prepare(
        "UPDATE libraries SET owner_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(admin.id, library.id);
      db.prepare(
        "INSERT INTO library_members(library_id,user_id,role) VALUES(?,?,'owner') ON CONFLICT(library_id,user_id) DO UPDATE SET role='owner'",
      ).run(library.id, admin.id);
    }
    audit(admin.id, "user.delete", "user", userId, {
      name: current.name,
      email: current.email,
      role: current.role,
      transferredLibraries: ownedLibraries.length,
    });
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return json({ deleted: true, transferredLibraries: ownedLibraries.length });
}

async function updateContactMessage(request: Request, id: string) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const status = requiredString(body.status, "Message status");
  if (!new Set(["new", "in_progress", "resolved", "spam"]).has(status))
    throw new HttpError(400, "Unsupported message status.");
  const result = getDb().prepare("UPDATE contact_messages SET status=? WHERE id=?").run(status, id);
  if (!result.changes) throw new HttpError(404, "Contact message not found.");
  audit(admin.id, "contact.update", "contact_message", id, { status });
  return json({ updated: true, status });
}

function adminCount() {
  return Number(
    (
      getDb().prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin'").get() as {
        count: number;
      }
    ).count,
  );
}

function reindexSearch(request: Request) {
  const admin = requireAdmin(request);
  const result = rebuildDocumentChunkIndex();
  audit(admin.id, "search.reindex", "search", null, result);
  return json({ reindexed: true, ...result });
}

function adminDashboard(request: Request) {
  requireAdmin(request);
  const db = getDb();
  const scalar = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count);
  const topSubjects = db
    .prepare(
      `
    SELECT subject,COUNT(*) AS count FROM documents WHERE status='published' GROUP BY subject ORDER BY count DESC LIMIT 8
  `,
    )
    .all();
  const missing = db
    .prepare(
      `
    SELECT query,COUNT(*) AS searches,MAX(created_at) AS last_searched
    FROM search_logs WHERE result_count=0 AND json_extract(filters_json,'$.insideDocument') IS NULL GROUP BY normalized_query ORDER BY searches DESC LIMIT 10
  `,
    )
    .all();
  const contactMessages = db
    .prepare(
      `
    SELECT id,email,subject,message,status,created_at FROM contact_messages
    ORDER BY datetime(created_at) DESC LIMIT 8
  `,
    )
    .all();
  return json({
    metrics: {
      totalDocuments: scalar("SELECT COUNT(*) AS count FROM documents"),
      publishedDocuments: scalar(
        "SELECT COUNT(*) AS count FROM documents WHERE status='published'",
      ),
      totalSearches: scalar("SELECT COUNT(*) AS count FROM search_logs"),
      searchableChunks: scalar("SELECT COUNT(*) AS count FROM document_chunks"),
      totalDownloads: scalar("SELECT COALESCE(SUM(downloads),0) AS count FROM documents"),
      totalViews: scalar("SELECT COALESCE(SUM(views),0) AS count FROM documents"),
      pendingUploads: scalar(
        "SELECT COUNT(*) AS count FROM documents WHERE status='awaiting_review'",
      ),
      ocrJobs: scalar("SELECT COUNT(*) AS count FROM ocr_jobs"),
      ocrAwaitingCorrection: scalar(
        "SELECT COUNT(*) AS count FROM ocr_jobs WHERE status='awaiting_correction'",
      ),
      duplicateWarnings: scalar(
        "SELECT COUNT(*) AS count FROM staged_uploads WHERE json_extract(duplicate_json,'$.kind') <> 'none'",
      ),
      newContactMessages: scalar(
        "SELECT COUNT(*) AS count FROM contact_messages WHERE status='new'",
      ),
      openReports: scalar(
        "SELECT COUNT(*) AS count FROM document_reports WHERE status IN ('open','reviewing')",
      ),
      openCopyrightRequests: scalar(
        "SELECT COUNT(*) AS count FROM copyright_requests WHERE status IN ('submitted','reviewing','restricted')",
      ),
      restrictedDocuments: scalar(
        "SELECT COUNT(*) AS count FROM documents WHERE rights_status IN ('restricted','removed')",
      ),
      totalLibraries: scalar("SELECT COUNT(*) AS count FROM libraries"),
      privateLibraries: scalar(
        "SELECT COUNT(*) AS count FROM libraries WHERE visibility='private'",
      ),
      totalUsers: scalar("SELECT COUNT(*) AS count FROM users"),
      totalAdmins: scalar("SELECT COUNT(*) AS count FROM users WHERE role='admin'"),
    },
    topSubjects,
    missingSearches: missing,
    contactMessages,
  });
}

function adminDocuments(request: Request, url: URL) {
  const admin = requireAdmin(request);
  const status = url.searchParams.get("status") || "awaiting_review";
  const query = (url.searchParams.get("q") || "").trim().slice(0, 160);
  const where: string[] = [];
  const params: Array<string> = [];
  if (status !== "all") {
    where.push("status=?");
    params.push(status);
  }
  if (query) {
    where.push(
      "(lower(title) LIKE lower(?) OR lower(subject) LIKE lower(?) OR lower(COALESCE(institution,'')) LIKE lower(?))",
    );
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM documents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY datetime(created_at) DESC LIMIT 250`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return json({ documents: rows.map((row) => mapDocument(row, admin, true)) });
}

function missingSearches(request: Request) {
  requireAdmin(request);
  const rows = getDb()
    .prepare(
      `
    SELECT normalized_query,query,COUNT(*) AS searches,MAX(created_at) AS lastSearched
    FROM search_logs WHERE result_count=0 AND json_extract(filters_json,'$.insideDocument') IS NULL GROUP BY normalized_query ORDER BY searches DESC,lastSearched DESC LIMIT 100
  `,
    )
    .all();
  return json({ searches: rows });
}

function adminReports(request: Request, url: URL) {
  requireAdmin(request);
  const status = url.searchParams.get("status") || "open";
  const rows = getDb()
    .prepare(
      `
    SELECT r.id,r.document_id AS documentId,d.title AS documentTitle,r.reason,r.details,r.status,
           r.resolution_note AS resolutionNote,r.created_at AS createdAt,r.updated_at AS updatedAt,
           u.name AS reporterName,u.email AS reporterEmail
    FROM document_reports r
    JOIN documents d ON d.id=r.document_id
    LEFT JOIN users u ON u.id=r.user_id
    WHERE r.status=? ORDER BY datetime(r.created_at) DESC LIMIT 100
  `,
    )
    .all(status);
  return json({ reports: rows });
}

async function updateReport(request: Request, id: string) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const status = requiredString(body.status, "Report status");
  if (!new Set(["open", "reviewing", "resolved", "dismissed"]).has(status))
    throw new HttpError(400, "Unsupported report status.");
  const note =
    typeof body.resolutionNote === "string" ? body.resolutionNote.trim().slice(0, 1000) : null;
  const db = getDb();
  const row = db.prepare("SELECT user_id,document_id FROM document_reports WHERE id=?").get(id) as
    { user_id: string | null; document_id: string } | undefined;
  if (!row) throw new HttpError(404, "Report not found.");
  db.prepare(
    "UPDATE document_reports SET status=?,resolution_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).run(status, note, id);
  if (row.user_id && (status === "resolved" || status === "dismissed")) {
    createNotification(
      row.user_id,
      "report_update",
      "Document report updated",
      note || `Your document report was ${status}.`,
      `/document/${row.document_id}`,
    );
  }
  audit(admin.id, "report.update", "document_report", id, { status, note });
  return json({ updated: true });
}

function adminCopyrightRequests(request: Request, url: URL) {
  requireAdmin(request);
  const requested = url.searchParams.get("status") || "active";
  const allowed = new Set(["submitted", "reviewing", "restricted", "resolved", "dismissed"]);
  const where =
    requested === "active"
      ? "c.status IN ('submitted','reviewing','restricted')"
      : allowed.has(requested)
        ? "c.status=?"
        : "c.status IN ('submitted','reviewing','restricted')";
  const params = requested !== "active" && allowed.has(requested) ? [requested] : [];
  const rows = getDb()
    .prepare(
      `
    SELECT c.id,c.document_id AS documentId,d.title AS documentTitle,d.rights_status AS documentRightsStatus,
           c.claimant_name AS claimantName,c.claimant_email AS claimantEmail,c.claimant_organization AS claimantOrganization,
           c.relationship,c.requested_action AS requestedAction,c.statement,c.evidence_filename AS evidenceFilename,
           c.status,c.resolution_action AS resolutionAction,c.resolution_note AS resolutionNote,
           c.created_at AS createdAt,c.updated_at AS updatedAt,u.name AS reviewerName
    FROM copyright_requests c
    JOIN documents d ON d.id=c.document_id
    LEFT JOIN users u ON u.id=c.reviewed_by
    WHERE ${where}
    ORDER BY CASE c.status WHEN 'submitted' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'restricted' THEN 2 ELSE 3 END, datetime(c.created_at) DESC
    LIMIT 150
  `,
    )
    .all(...params);
  return json({ requests: rows });
}

async function copyrightEvidence(request: Request, id: string) {
  requireAdmin(request);
  const row = getDb()
    .prepare("SELECT evidence_path,evidence_filename FROM copyright_requests WHERE id=?")
    .get(id) as { evidence_path: string | null; evidence_filename: string | null } | undefined;
  if (!row?.evidence_path)
    throw new HttpError(404, "No evidence file is attached to this request.");
  return servePrivateFile(row.evidence_path, row.evidence_filename || "copyright-evidence");
}

async function updateCopyrightRequest(request: Request, id: string) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const action = requiredString(body.action, "Copyright action");
  const allowed = new Set([
    "review",
    "restrict",
    "contact_uploader",
    "restore",
    "remove",
    "keep_restricted",
    "dismiss",
  ]);
  if (!allowed.has(action)) throw new HttpError(400, "Unsupported copyright action.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 3000) : "";
  if (
    ["restrict", "restore", "remove", "keep_restricted", "dismiss"].includes(action) &&
    note.length < 5
  ) {
    throw new HttpError(400, "Add a short decision note for the audit record.");
  }
  const database = getDb();
  const row = database
    .prepare(
      `
    SELECT c.*,d.title,d.uploaded_by,d.rights_status,d.status AS document_status
    FROM copyright_requests c JOIN documents d ON d.id=c.document_id WHERE c.id=?
  `,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "Copyright request not found.");

  const documentId = String(row.document_id);
  let requestStatus = String(row.status);
  let resolutionAction = String(row.resolution_action || "none");
  let notification = "The copyright request is being reviewed.";
  database.exec("BEGIN IMMEDIATE");
  try {
    if (action === "review") {
      requestStatus = "reviewing";
      database
        .prepare(
          "UPDATE documents SET rights_status=CASE WHEN rights_status='clear' THEN 'claimed' ELSE rights_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(documentId);
    } else if (action === "restrict") {
      requestStatus = "restricted";
      database
        .prepare(
          "UPDATE documents SET rights_status='restricted',rights_restriction_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(note, documentId);
      notification =
        "The document has been temporarily restricted while the copyright request is reviewed.";
    } else if (action === "contact_uploader") {
      requestStatus = "reviewing";
      resolutionAction = "contacted_uploader";
      notification = "The uploader has been asked to provide rights information.";
      if (row.uploaded_by)
        createNotification(
          String(row.uploaded_by),
          "copyright_information_requested",
          "Rights information requested",
          note || `An administrator needs copyright information for ${String(row.title)}.`,
          "/saved",
        );
    } else if (action === "remove") {
      requestStatus = "resolved";
      resolutionAction = "removed";
      database
        .prepare(
          "UPDATE documents SET status='archived',rights_status='removed',rights_restriction_note=?,download_status='restricted',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(note, documentId);
      notification = "The document was removed after copyright review.";
    } else if (action === "keep_restricted") {
      requestStatus = "resolved";
      resolutionAction = "kept_restricted";
      database
        .prepare(
          "UPDATE documents SET rights_status='restricted',rights_restriction_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(note, documentId);
      notification = "The document will remain restricted after copyright review.";
    } else if (action === "restore" || action === "dismiss") {
      requestStatus = action === "dismiss" ? "dismissed" : "resolved";
      resolutionAction = "restored";
      const otherBlock = database
        .prepare(
          `
        SELECT 1 FROM copyright_requests
        WHERE document_id=? AND id<>? AND (status='restricted' OR resolution_action IN ('removed','kept_restricted')) LIMIT 1
      `,
        )
        .get(documentId, id);
      if (!otherBlock) {
        const republish =
          String(row.rights_status) === "removed" && String(row.document_status) === "archived";
        database
          .prepare(
            `
          UPDATE documents SET rights_status='clear',rights_restriction_note=NULL,download_status='allowed',
            status=CASE WHEN ? THEN 'published' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?
        `,
          )
          .run(republish ? 1 : 0, documentId);
      }
      notification =
        action === "dismiss"
          ? "The copyright request was dismissed after review."
          : "The document was restored after copyright review.";
    }

    database
      .prepare(
        `
      UPDATE copyright_requests SET status=?,resolution_action=?,resolution_note=?,reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `,
      )
      .run(requestStatus, resolutionAction, note || null, admin.id, id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  refreshDocumentFts(documentId);
  if (row.claimant_user_id)
    createNotification(
      String(row.claimant_user_id),
      "copyright_request_update",
      "Copyright request updated",
      notification,
      "/policies",
    );
  if (row.uploaded_by)
    createNotification(
      String(row.uploaded_by),
      "document_rights_update",
      "Document rights status updated",
      `${String(row.title)}: ${notification}`,
      "/saved",
    );
  audit(admin.id, `copyright.${action}`, "copyright_request", id, {
    documentId,
    requestStatus,
    resolutionAction,
    note,
  });
  return json({ updated: true, status: requestStatus, resolutionAction });
}

function adminTaxonomy(request: Request) {
  requireAdmin(request);
  const db = getDb();
  const subjects = db
    .prepare(
      `
    SELECT s.id,s.name,s.description,COUNT(DISTINCT t.id) AS topicCount,COUNT(DISTINCT d.id) AS documentCount
    FROM subjects s
    LEFT JOIN topics t ON t.subject_id=s.id
    LEFT JOIN documents d ON lower(d.subject)=lower(s.name)
    GROUP BY s.id ORDER BY s.name
  `,
    )
    .all();
  const topics = db
    .prepare(
      `
    SELECT t.id,t.subject_id AS subjectId,s.name AS subjectName,t.name,t.description,t.synonyms_json AS synonymsJson,t.related_json AS relatedJson
    FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id ORDER BY COALESCE(s.name,''),t.name
  `,
    )
    .all() as Array<Record<string, unknown>>;
  return json({
    subjects,
    topics: topics.map((topic) => ({
      id: Number(topic.id),
      subjectId: topic.subjectId == null ? null : Number(topic.subjectId),
      subjectName: topic.subjectName ? String(topic.subjectName) : null,
      name: String(topic.name),
      description: String(topic.description || ""),
      synonyms: jsonArray(topic.synonymsJson),
      related: jsonArray(topic.relatedJson),
    })),
  });
}

async function createSubject(request: Request) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const name = requiredString(body.name, "Subject name").slice(0, 120);
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (getDb().prepare("SELECT 1 FROM subjects WHERE lower(name)=lower(?)").get(name))
    throw new HttpError(409, "A subject with that name already exists.");
  try {
    const result = getDb()
      .prepare("INSERT INTO subjects(name,description) VALUES(?,?)")
      .run(name, description);
    audit(admin.id, "subject.create", "subject", String(result.lastInsertRowid), { name });
    return json({ subject: { id: Number(result.lastInsertRowid), name, description } }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new HttpError(409, "A subject with that name already exists.");
    throw error;
  }
}

async function updateSubject(request: Request, id: number) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const current = getDb().prepare("SELECT name,description FROM subjects WHERE id=?").get(id) as
    { name: string; description: string } | undefined;
  if (!current) throw new HttpError(404, "Subject not found.");
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : current.name;
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, 500)
      : current.description;
  getDb().prepare("UPDATE subjects SET name=?,description=? WHERE id=?").run(name, description, id);
  if (name !== current.name && body.renameDocuments === true) {
    const docs = getDb()
      .prepare("SELECT id FROM documents WHERE lower(subject)=lower(?)")
      .all(current.name) as Array<{ id: string }>;
    getDb()
      .prepare(
        "UPDATE documents SET subject=?,updated_at=CURRENT_TIMESTAMP WHERE lower(subject)=lower(?)",
      )
      .run(name, current.name);
    docs.forEach((document) => refreshDocumentFts(document.id));
  }
  audit(admin.id, "subject.update", "subject", String(id), { name, previousName: current.name });
  return json({ subject: { id, name, description } });
}

function deleteSubject(request: Request, id: number) {
  const admin = requireAdmin(request);
  const db = getDb();
  const subject = db.prepare("SELECT id,name FROM subjects WHERE id=?").get(id) as
    { id: number; name: string } | undefined;
  if (!subject) throw new HttpError(404, "Subject not found.");
  const documentCount = Number(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM documents WHERE lower(subject)=lower(?)")
        .get(subject.name) as { count: number }
    ).count,
  );
  if (documentCount)
    throw new HttpError(
      409,
      `Rename or reclassify ${documentCount} linked document${documentCount === 1 ? "" : "s"} before deleting this subject.`,
    );
  db.prepare("DELETE FROM subjects WHERE id=?").run(id);
  audit(admin.id, "subject.delete", "subject", String(id), { name: subject.name });
  return json({ deleted: true });
}

async function createTopic(request: Request) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const name = requiredString(body.name, "Topic name").slice(0, 120);
  const subjectId = body.subjectId == null || body.subjectId === "" ? null : Number(body.subjectId);
  if (subjectId != null && !getDb().prepare("SELECT id FROM subjects WHERE id=?").get(subjectId))
    throw new HttpError(404, "Subject not found.");
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const synonyms = toStringArray(body.synonyms).slice(0, 30);
  const related = toStringArray(body.related).slice(0, 30);
  if (getDb().prepare("SELECT 1 FROM topics WHERE lower(name)=lower(?)").get(name))
    throw new HttpError(409, "A topic with that name already exists.");
  try {
    const result = getDb()
      .prepare(
        "INSERT INTO topics(subject_id,name,description,synonyms_json,related_json) VALUES(?,?,?,?,?)",
      )
      .run(subjectId, name, description, JSON.stringify(synonyms), JSON.stringify(related));
    audit(admin.id, "topic.create", "topic", String(result.lastInsertRowid), { name, subjectId });
    return json(
      {
        topic: {
          id: Number(result.lastInsertRowid),
          subjectId,
          name,
          description,
          synonyms,
          related,
        },
      },
      201,
    );
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new HttpError(409, "A topic with that name already exists.");
    throw error;
  }
}

async function updateTopic(request: Request, id: number) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const current = getDb().prepare("SELECT * FROM topics WHERE id=?").get(id) as
    Record<string, unknown> | undefined;
  if (!current) throw new HttpError(404, "Topic not found.");
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : String(current.name);
  const subjectId: number | null =
    body.subjectId === undefined
      ? current.subject_id == null
        ? null
        : Number(current.subject_id)
      : body.subjectId == null || body.subjectId === ""
        ? null
        : Number(body.subjectId);
  if (
    subjectId != null &&
    (!Number.isInteger(subjectId) ||
      !getDb().prepare("SELECT id FROM subjects WHERE id=?").get(subjectId))
  ) {
    throw new HttpError(404, "Subject not found.");
  }
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, 500)
      : String(current.description || "");
  const synonyms =
    body.synonyms === undefined
      ? jsonArray(current.synonyms_json)
      : toStringArray(body.synonyms).slice(0, 30);
  const related =
    body.related === undefined
      ? jsonArray(current.related_json)
      : toStringArray(body.related).slice(0, 30);
  getDb()
    .prepare(
      "UPDATE topics SET subject_id=?,name=?,description=?,synonyms_json=?,related_json=? WHERE id=?",
    )
    .run(subjectId, name, description, JSON.stringify(synonyms), JSON.stringify(related), id);
  audit(admin.id, "topic.update", "topic", String(id), { name, subjectId });
  return json({ topic: { id, subjectId, name, description, synonyms, related } });
}

function deleteTopic(request: Request, id: number) {
  const admin = requireAdmin(request);
  const topic = getDb().prepare("SELECT id,name FROM topics WHERE id=?").get(id) as
    { id: number; name: string } | undefined;
  if (!topic) throw new HttpError(404, "Topic not found.");
  getDb().prepare("DELETE FROM topics WHERE id=?").run(id);
  audit(admin.id, "topic.delete", "topic", String(id), { name: topic.name });
  return json({ deleted: true });
}

async function moderateDocument(request: Request, id: string) {
  const admin = requireAdmin(request);
  const body = await readJson(request);
  const action =
    typeof body.action === "string" && body.action.trim() ? body.action.trim() : "update";
  if (action === "update") {
    const db = getDb();
    const current = db.prepare("SELECT * FROM documents WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    if (!current) throw new HttpError(404, "Document not found.");
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 220)
        : String(current.title);
    const subject =
      typeof body.subject === "string" && body.subject.trim()
        ? body.subject.trim().slice(0, 120)
        : String(current.subject);
    const description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, 3000)
        : String(current.description || "");
    const institution =
      typeof body.institution === "string"
        ? body.institution.trim().slice(0, 180)
        : String(current.institution || "");
    const author =
      typeof body.author === "string"
        ? body.author.trim().slice(0, 180)
        : String(current.author || "");
    const year: number | null =
      body.year === undefined
        ? current.year == null
          ? null
          : Number(current.year)
        : body.year === null || body.year === ""
          ? null
          : Number(body.year);
    if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2100))
      throw new HttpError(400, "Year must be between 1900 and 2100.");
    db.prepare(
      "UPDATE documents SET title=?,subject=?,description=?,institution=?,author=?,year=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(title, subject, description, institution || null, author || null, year, id);
    refreshDocumentFts(id);
    audit(admin.id, "document.update", "document", id, { title, subject, year });
    return json({
      document: mapDocument(db.prepare("SELECT * FROM documents WHERE id=?").get(id), admin, true),
    });
  }
  const allowed: Record<string, string> = {
    approve: "published",
    publish: "published",
    reject: "rejected",
    archive: "archived",
    unpublish: "approved",
    request_changes: "changes_requested",
  };
  const status = allowed[action];
  if (!status) throw new HttpError(400, "Unsupported moderation action.");
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
  const db = getDb();
  const before = db
    .prepare(
      "SELECT title,subject,topics_json,uploaded_by,visibility,library_id FROM documents WHERE id=?",
    )
    .get(id) as Record<string, unknown> | undefined;
  const result = db
    .prepare(
      "UPDATE documents SET status=?,rejection_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(status, reason, id);
  if (!result.changes) throw new HttpError(404, "Document not found.");
  refreshDocumentFts(id);
  if (before?.uploaded_by) {
    const title = String(before.title || "Document");
    const message =
      status === "published"
        ? `${title} was approved and is now searchable.`
        : status === "rejected"
          ? `${title} was rejected${reason ? `: ${reason}` : "."}`
          : `${title} needs changes${reason ? `: ${reason}` : "."}`;
    createNotification(
      String(before.uploaded_by),
      `document_${status}`,
      `Document ${status.replaceAll("_", " ")}`,
      message,
      status === "published" ? `/document/${id}` : "/saved",
    );
  }
  if (status === "published" && before) notifyTopicFollowers(id, before);
  audit(admin.id, `document.${action}`, "document", id, { reason, status });
  return json({
    document: mapDocument(db.prepare("SELECT * FROM documents WHERE id=?").get(id), admin, true),
  });
}

async function deleteAdminDocument(request: Request, id: string) {
  const admin = requireAdmin(request);
  const db = getDb();
  const document = db
    .prepare("SELECT id,title,storage_path,preview_path FROM documents WHERE id=?")
    .get(id) as
    | { id: string; title: string; storage_path: string | null; preview_path: string | null }
    | undefined;
  if (!document) throw new HttpError(404, "Document not found.");
  audit(admin.id, "document.delete", "document", id, { title: document.title });
  db.prepare("DELETE FROM documents WHERE id=?").run(id);
  for (const candidate of [document.storage_path, document.preview_path]) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    const storageRoot = path.resolve(dataDir);
    if (resolved !== storageRoot && resolved.startsWith(`${storageRoot}${path.sep}`))
      await unlink(resolved).catch(() => undefined);
  }
  return json({ deleted: true });
}

function mapDocument(row: unknown, user: SessionUser | null, includeContent = false) {
  const item = row as Record<string, unknown>;
  const id = String(item.id);
  const saved = user
    ? Boolean(
        getDb()
          .prepare("SELECT 1 FROM saved_documents WHERE user_id=? AND document_id=?")
          .get(user.id, id),
      )
    : false;
  const ratingStats = getDb()
    .prepare(
      "SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS average FROM document_ratings WHERE document_id=?",
    )
    .get(id) as { count: number; average: number };
  const userRating = user
    ? ((
        getDb()
          .prepare("SELECT rating FROM document_ratings WHERE user_id=? AND document_id=?")
          .get(user.id, id) as { rating: number } | undefined
      )?.rating ?? null)
    : null;
  const library = item.library_id
    ? (getDb()
        .prepare(
          `
        SELECT l.id,l.name,l.visibility,
          (SELECT role FROM library_members lm WHERE lm.library_id=l.id AND lm.user_id=?) AS member_role
        FROM libraries l WHERE l.id=?
      `,
        )
        .get(user?.id ?? "", String(item.library_id)) as Record<string, unknown> | undefined)
    : undefined;
  const createdAt = String(item.created_at || new Date().toISOString());
  return {
    id,
    title: String(item.title),
    subject: String(item.subject),
    topics: jsonArray(item.topics_json),
    docType: String(item.doc_type),
    year: item.year == null ? null : Number(item.year),
    level: String(item.level || "Unspecified"),
    language: String(item.language || "English"),
    fileType: String(item.file_type),
    pages: Number(item.pages || 1),
    size: formatBytes(Number(item.size_bytes || 0)),
    sizeBytes: Number(item.size_bytes || 0),
    institution: item.institution ? String(item.institution) : undefined,
    author: item.author ? String(item.author) : undefined,
    downloads: Number(item.downloads || 0),
    views: Number(item.views || 0),
    rating: ratingStats.count ? Number(ratingStats.average) : Number(item.rating || 0),
    ratingCount: Number(ratingStats.count || 0),
    userRating,
    addedDaysAgo: Math.max(
      0,
      Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000),
    ),
    createdAt,
    description: String(item.description || ""),
    snippet: stripMarkup(
      String(item.match_snippet || item.extracted_text || item.description || ""),
    ).slice(0, 280),
    matchPage: item.match_page == null ? undefined : Number(item.match_page),
    matchHeading: item.match_heading ? String(item.match_heading) : undefined,
    matchQuery: item.match_query ? String(item.match_query) : undefined,
    keywords: jsonArray(item.keywords_json),
    status: String(item.status || "published"),
    previewStatus: String(item.preview_status || "available"),
    downloadStatus: String(item.download_status || "allowed"),
    visibility: String(item.visibility || "public"),
    libraryId: item.library_id ? String(item.library_id) : undefined,
    libraryName: library?.name ? String(library.name) : undefined,
    libraryRole: library?.member_role
      ? String(library.member_role)
      : user?.role === "admin" && library
        ? "admin"
        : undefined,
    rightsBasis: String(item.rights_basis || "unspecified"),
    sourceAttribution: String(item.source_attribution || ""),
    rightsStatus: String(item.rights_status || "clear"),
    rightsRestrictionNote:
      user?.role === "admin" && item.rights_restriction_note
        ? String(item.rights_restriction_note)
        : undefined,
    isSaved: saved,
    ...(includeContent
      ? {
          content: String(item.extracted_text || ""),
          rejectionReason: item.rejection_reason || undefined,
        }
      : {}),
  };
}

function normalizeOcrStage(row: Record<string, unknown>) {
  const status = String(row.status || "processing");
  const stage = String(row.processing_stage || "");
  if (status === "published") return "published";
  if (status === "ready") return "verified";
  if (status === "awaiting_correction") return "awaiting_review";
  if (status === "failed") return "failed";
  if (stage && stage !== "uploaded") return stage as any;
  return "processing";
}

function mapOcrJob(row: Record<string, unknown>) {
  const structure = normalizeOcrStructure(
    jsonObject(row.structure_json),
    String(row.corrected_text || row.extracted_text || ""),
    Number(row.confidence || 0),
  );
  const enhancedPages = jsonArray(row.enhanced_paths_json);
  const sourcePaths = jsonArray(row.source_paths_json);
  const sourceFilenames = jsonArray(row.source_filenames_json);
  const fallbackSourcePath = String(row.source_path || "");
  const effectiveSourcePaths = sourcePaths.length
    ? sourcePaths
    : fallbackSourcePath
      ? [fallbackSourcePath]
      : [];
  const effectiveSourceFilenames = sourceFilenames.length
    ? sourceFilenames
    : [String(row.original_filename || "scan")];
  const id = String(row.id);
  const metadata = jsonObject(row.metadata_json);
  const db = getDb();
  const preflightRow = db
    .prepare("SELECT * FROM ocr_preflight_results WHERE job_id=? AND revision=?")
    .get(id, Number(row.revision || 1)) as Record<string, unknown> | undefined;
  const preflight = preflightRow
    ? {
        ready: Number(preflightRow.ready || 0) === 1,
        score: Number(preflightRow.score || 0),
        errors: jsonArray(preflightRow.errors_json),
        warnings: jsonArray(preflightRow.warnings_json),
        checks: jsonArray(preflightRow.checks_json),
      }
    : assessReconstructionQuality(structure, metadata);
  return {
    id,
    contributorUserId: row.user_id ? String(row.user_id) : undefined,
    originalFilename: String(row.original_filename),
    sourceUrl: `/api/ocr/jobs/${encodeURIComponent(id)}/source`,
    sourcePaths: effectiveSourcePaths,
    sourceFilenames: effectiveSourceFilenames,
    combineAsDocument: Number(row.combine_as_document ?? 1) === 1,
    enhancedPaths: enhancedPages.map(
      (_, index) => `/api/ocr/jobs/${encodeURIComponent(id)}/pages/${index + 1}`,
    ),
    extractedText: String(row.extracted_text || ""),
    correctedText: String(row.corrected_text || ""),
    confidence: Number(row.confidence || 0),
    qualityScore: Number(row.quality_score || row.confidence || 0),
    profile: String(row.ocr_profile || "exam"),
    language: String(row.ocr_language || "eng"),
    qualityMode: String(row.ocr_quality_mode || "accurate"),
    stage: normalizeOcrStage(row),
    pipeline: normalizePipelineReport(
      jsonObject(row.pipeline_json),
      Number(row.quality_score || row.confidence || 0),
      String(row.ocr_profile || "exam"),
      String(row.ocr_quality_mode || "accurate"),
      String(row.ocr_language || "eng"),
    ),
    metadata,
    structure,
    revision: Number(row.revision || 1),
    publishedDocumentId: row.published_document_id ? String(row.published_document_id) : undefined,
    rightsBasis: String(row.rights_basis || "unspecified"),
    sourceAttribution: String(row.source_attribution || ""),
    rightsDeclared: Number(row.rights_declared || 0) === 1,
    rightsDeclaredBy: row.rights_declared_by ? String(row.rights_declared_by) : undefined,
    rightsDeclaredAt: row.rights_declared_at ? String(row.rights_declared_at) : undefined,
    status: String(row.status),
    processingStage: normalizeOcrStage(row),
    progress: Number(row.progress || (row.status === "processing" ? 50 : 100)),
    pagesCompleted: Number(row.pages_completed || structure.stats.pages || 0),
    totalPages: Number(
      row.total_pages || effectiveSourcePaths.length || structure.stats.pages || 1,
    ),
    currentStage: String(
      row.current_stage ||
        (row.status === "processing"
          ? "Processing OCR..."
          : row.status === "published"
            ? "Published"
            : preflight.ready
              ? "Verified"
              : "Awaiting review"),
    ),
    diagnostics: jsonObject(row.diagnostics_json),
    documentType: String(row.document_type || "exam"),
    ready: preflight.ready,
    preflight,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizePipelineReport(
  raw: Record<string, unknown>,
  fallbackQuality: number,
  profile: string,
  qualityMode: string,
  language: string,
) {
  const passes = Array.isArray(raw.passes) ? raw.passes : [];
  return {
    engine: String(raw.engine || "tesseract-js"),
    profile,
    qualityMode,
    language,
    documentType: String(raw.documentType || inferOcrDocumentType(raw.documentType || "mixed")),
    qualityScore: Number(raw.qualityScore ?? fallbackQuality),
    orientationCorrection: Number(raw.orientationCorrection || 0),
    skewAngle: Number(raw.skewAngle || 0),
    ensembleAgreement: Number(raw.ensembleAgreement ?? 100),
    disagreementLines: Number(raw.disagreementLines || 0),
    autoCorrections: Number(raw.autoCorrections || 0),
    layoutMode: String(raw.layoutMode || "single-column"),
    selectedPass: String(raw.selectedPass || "legacy-pass"),
    passes,
    lowConfidenceLines: Number(raw.lowConfidenceLines || 0),
    suspiciousCharacterRate: Number(raw.suspiciousCharacterRate || 0),
    processingMs: Number(raw.processingMs || 0),
    perspectiveCorrection: Boolean(raw.perspectiveCorrection),
    illuminationNormalized: Boolean(raw.illuminationNormalized),
    cropConfidence: Number(raw.cropConfidence || 0),
    glareScore: Number(raw.glareScore || 0),
    shadowScore: Number(raw.shadowScore || 0),
    contrastScore: Number(raw.contrastScore ?? 100),
    pageConsistency: Number(raw.pageConsistency ?? 100),
    mathLines: Number(raw.mathLines || 0),
    tableRows: Number(raw.tableRows || 0),
    visionRefinements: Number(raw.visionRefinements || 0),
    blurScore: Number(raw.blurScore || 0),
    handwritingRisk: Number(raw.handwritingRisk || 0),
    tableGridScore: Number(raw.tableGridScore || 0),
    lineDensity: Number(raw.lineDensity || 0),
    detectedFigures: Number(raw.detectedFigures || 0),
    detectedTables: Number(raw.detectedTables || 0),
    preservedVisuals: Number(raw.preservedVisuals || 0),
    exportReadiness: Number(raw.exportReadiness ?? fallbackQuality),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((item) => String(item)).slice(0, 30)
      : [],
    ...(Array.isArray(raw.pages) ? { pages: raw.pages } : {}),
  };
}

function getOcrJobRow(id: string) {
  const row = getDb().prepare("SELECT * FROM ocr_jobs WHERE id=?").get(id) as
    Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "OCR job not found.");
  return mapOcrJob(row);
}

function normalizeOcrProfile(value: unknown): OcrProfile {
  const normalized = String(value || "exam");
  return (["auto", "exam", "notes", "table", "mixed"] as readonly string[]).includes(normalized)
    ? (normalized as OcrProfile)
    : "exam";
}

function normalizeOcrQualityMode(value: unknown): OcrQualityMode {
  const normalized = String(value || "accurate");
  return (["fast", "balanced", "accurate"] as const).includes(normalized as OcrQualityMode)
    ? (normalized as OcrQualityMode)
    : "accurate";
}

function normalizeOcrLanguage(value: unknown) {
  return (
    String(value || process.env.OCR_LANGUAGE || "eng")
      .replace(/[^a-z0-9_+,-]/gi, "")
      .slice(0, 80) || "eng"
  );
}

async function suggestMetadata(filename: string, text: string, fileType: string, pages: number) {
  const deterministic = inferMetadata(filename, text, fileType, pages);
  const aiBaseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "");
  const model = process.env.AI_CHAT_MODEL;
  if (!aiBaseUrl || !model) return deterministic;
  try {
    const response = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You classify academic documents for EduSearch AI. Return strict JSON with title, subject, topics (array), docType, year, level, language, description, keywords (array), institution, author. Institution and author may be empty. Never invent facts that are not supported by the filename or text.",
          },
          {
            role: "user",
            content: `Filename: ${filename}\nFile type: ${fileType}\nPages: ${pages}\n\nExtracted text:\n${text.slice(0, 12000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return deterministic;
    const payload = (await response.json()) as Record<string, unknown>;
    const content = String(
      (
        (payload.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
          Record<string, unknown> | undefined
      )?.content || "",
    );
    return normalizeMetadata(JSON.parse(content), deterministic);
  } catch {
    return deterministic;
  }
}

function inferMetadata(filename: string, text: string, fileType: string, pages: number) {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const haystack = `${base}\n${text.slice(0, 8000)}`.toLowerCase();
  const year = Number(haystack.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || new Date().getFullYear());
  const docType = inferDocType(haystack);
  const subject = inferSubject(haystack);
  const topics = inferTopics(haystack, subject);
  const title = titleCase(base || `${subject} ${docType} ${year}`);
  const keywords = unique([
    subject,
    docType,
    String(year),
    ...topics,
    ...tokenize(base).slice(0, 8),
  ]);
  return {
    title,
    subject,
    topics,
    docType,
    year,
    level: inferLevel(haystack),
    language: "English",
    description: text.trim()
      ? `${docType} covering ${topics.slice(0, 4).join(", ") || subject}. Extracted from ${filename} (${pages} page${pages === 1 ? "" : "s"}).`
      : `${docType} for ${subject}. Metadata was inferred from the filename because no readable text was extracted.`,
    keywords,
    institution: extractInstitution(text),
    author: "",
    fileType,
  };
}

function inferDocType(value: string) {
  if (
    /\bmarking scheme\b|\bmarking guide\b|\bscoring rubric\b|\bmodel answers\b|\baward marks\b/.test(
      value,
    )
  )
    return "Marking scheme";
  if (/prompting guide|prompt engineering|\bguide\b|handbook|reference manual|tutorial/.test(value))
    return "Notes";
  if (
    /lecture notes|lecture note|\bnotes\b|revision notes|course pack|chapter \d|unit \d/.test(value)
  )
    return "Notes";
  if (
    /examination|exam paper|past paper|end of semester|end of term|\bexam\b|\btest paper\b/.test(
      value,
    )
  )
    return "Exam";
  if (/assignment|coursework|homework|problem set/.test(value)) return "Assignment";
  if (/practical|laboratory|lab manual/.test(value)) return "Practical paper";
  if (/lecture slide|presentation|powerpoint|\bslides\b/.test(value)) return "Lecture slides";
  if (/course outline|syllabus/.test(value)) return "Course outline";
  if (/research|thesis|dissertation|journal article|conference paper/.test(value))
    return "Research document";
  return "Notes";
}

function inferSubject(value: string) {
  const rules: Array<[RegExp, string]> = [
    [/artificial intelligence|\bai\b|machine learning|expert systems/, "Artificial Intelligence"],
    [/python|object oriented|\boop\b/, "Python Programming"],
    [/database|\bdbms\b|\bsql\b|normalisation|normalization/, "Database Systems"],
    [/network|subnet|routing|osi model/, "Computer Networks"],
    [/cyber|information security|cryptography/, "Cybersecurity"],
    [/graphic design|typography|illustrator|photoshop/, "Graphic Design"],
    [/accounting|ledger|trial balance|bookkeeping/, "Accounting"],
    [/entrepreneur|business plan|innovation/, "Entrepreneurship"],
    [/electrical|wiring|solar installation|circuit/, "Electrical Engineering"],
    [/mechanical|thermodynamics|machine design/, "Mechanical Engineering"],
    [/civil engineering|construction|surveying/, "Civil Engineering"],
    [/communication skills|academic writing/, "Communication Skills"],
    [/mathematics|calculus|algebra|statistics/, "Mathematics"],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? "General Studies";
}

function inferTopics(value: string, subject: string) {
  const candidates = [
    "Machine Learning",
    "Expert Systems",
    "Natural Language Processing",
    "Search Algorithms",
    "Classes",
    "Inheritance",
    "Objects",
    "Exception Handling",
    "SQL",
    "Normalisation",
    "Transactions",
    "OSI Model",
    "Routing",
    "Subnetting",
    "Typography",
    "Layout",
    "Colour Theory",
    "Ledgers",
    "Trial Balance",
    "Business Plan",
    "Innovation",
    "Solar Installation",
    "Wiring",
  ];
  const matched = candidates.filter((candidate) => value.includes(candidate.toLowerCase()));
  return matched.length ? matched.slice(0, 8) : [subject];
}

function inferLevel(value: string) {
  if (/degree|bachelor|university/.test(value)) return "Degree";
  if (/diploma/.test(value)) return "Diploma";
  if (/certificate/.test(value)) return "Certificate";
  if (/secondary|form [1-4]|kcse/.test(value)) return "Secondary";
  if (/beginner|introduct/.test(value)) return "Beginner";
  return "Unspecified";
}

function extractInstitution(text: string) {
  const firstLines = text.split("\n").slice(0, 8).join(" ");
  const match = firstLines.match(
    /([A-Z][A-Za-z& ]+(?:University|College|Polytechnic|Institute|School))/,
  );
  return match?.[1]?.trim() || "";
}

function normalizeMetadata(value: unknown, fallback: Record<string, unknown>) {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const yearValue = Number(body.year ?? fallback.year ?? new Date().getFullYear());
  return {
    title: String(body.title || fallback.title || "Untitled Academic Document")
      .trim()
      .slice(0, 220),
    subject: String(body.subject || fallback.subject || "General Studies")
      .trim()
      .slice(0, 120),
    topics: toStringArray(body.topics ?? fallback.topics).slice(0, 20),
    docType: String(body.docType || fallback.docType || "Notes")
      .trim()
      .slice(0, 80),
    year: Number.isFinite(yearValue)
      ? Math.min(Math.max(yearValue, 1900), 2100)
      : new Date().getFullYear(),
    level: String(body.level || fallback.level || "Unspecified")
      .trim()
      .slice(0, 80),
    language: String(body.language || fallback.language || "English")
      .trim()
      .slice(0, 80),
    description: String(body.description || fallback.description || "")
      .trim()
      .slice(0, 3000),
    keywords: unique(toStringArray(body.keywords ?? fallback.keywords)).slice(0, 40),
    institution: String(body.institution || fallback.institution || "")
      .trim()
      .slice(0, 180),
    author: String(body.author || fallback.author || "")
      .trim()
      .slice(0, 180),
  };
}

function expandQuery(query: string) {
  const normalized = normalize(query);
  const tokens = new Set(tokenize(normalized));
  const expansions: string[] = [];
  if (normalized) {
    const rows = getDb().prepare("SELECT name,synonyms_json FROM topics").all() as Array<{
      name: string;
      synonyms_json: string;
    }>;
    for (const row of rows) {
      const synonyms = jsonArray(row.synonyms_json);
      const names = [row.name, ...synonyms];
      if (names.some((name) => normalized.includes(normalize(name)))) {
        for (const name of names) {
          expansions.push(name);
          tokenize(name).forEach((token) => tokens.add(token));
        }
      }
    }
  }
  return { tokens: [...tokens].slice(0, 50), expansions: unique(expansions).slice(0, 20) };
}

function buildSuggestions(query: string) {
  const vocabulary = getDb()
    .prepare("SELECT name FROM subjects UNION SELECT name FROM topics LIMIT 500")
    .all() as Array<{ name: string }>;
  const scored = vocabulary
    .map((row) => ({ value: row.name, score: similarity(normalize(query), normalize(row.name)) }))
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0.2)
    .slice(0, 6)
    .map((item) => item.value);
  return scored.length
    ? scored
    : [
        "Artificial Intelligence past paper",
        "Python OOP practical questions",
        "Database Management Systems notes",
      ];
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size, 1);
}

function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  link?: string | null,
) {
  getDb()
    .prepare("INSERT INTO notifications(id,user_id,type,title,message,link) VALUES(?,?,?,?,?,?)")
    .run(
      randomUUID(),
      userId,
      type.slice(0, 80),
      title.slice(0, 180),
      message.slice(0, 1000),
      link ? link.slice(0, 500) : null,
    );
}

function notifyTopicFollowers(documentId: string, document: Record<string, unknown>) {
  const terms = unique([String(document.subject || ""), ...jsonArray(document.topics_json)]).filter(
    Boolean,
  );
  if (!terms.length) return;
  const db = getDb();
  const placeholders = terms.map(() => "lower(?)").join(",");
  const followers = db
    .prepare(
      `
    SELECT DISTINCT user_id FROM followed_topics WHERE lower(topic_name) IN (${placeholders})
  `,
    )
    .all(...terms) as Array<{ user_id: string }>;
  const uploader = document.uploaded_by ? String(document.uploaded_by) : null;
  const libraryId = document.library_id ? String(document.library_id) : null;
  const restricted = String(document.visibility || "public") === "library";
  followers.forEach((follower) => {
    if (follower.user_id === uploader) return;
    if (restricted && !canUserAccessLibrary(follower.user_id, libraryId)) return;
    createNotification(
      follower.user_id,
      "followed_topic_document",
      "New document in a followed topic",
      `${String(document.title || "A new document")} was published under ${String(document.subject || terms[0])}.`,
      `/document/${documentId}`,
    );
  });
}

function audit(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
) {
  getDb()
    .prepare(
      "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?)",
    )
    .run(userId, action, entityType, entityId, JSON.stringify(details ?? {}));
}

function notifyAdmins(type: string, title: string, message: string, link?: string | null) {
  const rows = getDb().prepare("SELECT id FROM users WHERE role='admin'").all() as Array<{
    id: string;
  }>;
  for (const row of rows) createNotification(row.id, type, title, message, link);
}

function createDefaultCollections(userId: string) {
  const insert = getDb().prepare("INSERT INTO collections(id,user_id,name) VALUES(?,?,?)");
  for (const name of ["Revision", "Past papers", "Notes"]) insert.run(randomUUID(), userId, name);
}

function documentAccess(user: SessionUser | null, alias = "d") {
  if (user?.role === "admin") return { sql: "1=1", params: [] as Array<string | number> };
  const rights = `COALESCE(${alias}.rights_status,'clear') NOT IN ('restricted','removed')`;
  if (user) {
    return {
      sql: `(${rights} AND (${alias}.visibility IS NULL OR ${alias}.visibility='public' OR EXISTS (
        SELECT 1 FROM library_members access_member
        WHERE access_member.library_id=${alias}.library_id AND access_member.user_id=?
      )))`,
      params: [user.id] as Array<string | number>,
    };
  }
  return {
    sql: `(${rights} AND (${alias}.visibility IS NULL OR ${alias}.visibility='public'))`,
    params: [] as Array<string | number>,
  };
}

function requireLibraryAccess(id: string, user: SessionUser | null) {
  const library = getDb().prepare("SELECT * FROM libraries WHERE id=? OR slug=?").get(id, id) as
    Record<string, unknown> | undefined;
  if (!library) throw new HttpError(404, "Library not found.");
  if (user?.role === "admin") return { library, role: "admin" };
  const role = user
    ? ((
        getDb()
          .prepare("SELECT role FROM library_members WHERE library_id=? AND user_id=?")
          .get(String(library.id), user.id) as { role: string } | undefined
      )?.role ?? null)
    : null;
  if (String(library.visibility) !== "public" && !role)
    throw new HttpError(403, "This is a private library. Join it to continue.");
  return { library, role };
}

function requireLibraryManager(id: string, user: SessionUser) {
  const access = requireLibraryAccess(id, user);
  if (user.role !== "admin" && access.role !== "owner" && access.role !== "editor") {
    throw new HttpError(403, "Library editor access is required.");
  }
  return access.library;
}

function requireLibraryOwner(id: string, user: SessionUser) {
  const access = requireLibraryAccess(id, user);
  if (user.role !== "admin" && access.role !== "owner")
    throw new HttpError(403, "Library owner access is required.");
  return access;
}

function mapLibrary(row: Record<string, unknown>, user: SessionUser | null) {
  const role = row.member_role ? String(row.member_role) : user?.role === "admin" ? "admin" : null;
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    institution: String(row.institution || ""),
    description: String(row.description || ""),
    visibility: String(row.visibility || "private"),
    role,
    isMember: Boolean(role),
    canManage: role === "owner" || role === "editor" || role === "admin",
    joinCodeHint: row.join_code_hint ? String(row.join_code_hint) : "",
    memberCount: Number(row.member_count || 0),
    documentCount: Number(row.document_count || 0),
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

function generateJoinCode() {
  return `EDU-${randomBytes(6).toString("base64url").toUpperCase()}`;
}

function generateUniqueJoinCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateJoinCode();
    if (!getDb().prepare("SELECT 1 FROM libraries WHERE join_code_hash=?").get(hashJoinCode(code)))
      return code;
  }
  throw new HttpError(503, "Could not generate a unique join code. Try again.");
}

function hashJoinCode(value: string) {
  return createHash("sha256").update(value.trim().toUpperCase()).digest("hex");
}

function uniqueLibrarySlug(name: string) {
  const base = slugify(name) || "library";
  let slug = base;
  let counter = 2;
  while (getDb().prepare("SELECT 1 FROM libraries WHERE slug=?").get(slug))
    slug = `${base}-${counter++}`;
  return slug;
}

function canUserAccessLibrary(userId: string, libraryId: string | null) {
  if (!libraryId) return true;
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM library_members WHERE library_id=? AND user_id=?")
      .get(libraryId, userId),
  );
}

function ensurePublishedDocument(id: string, user: SessionUser | null) {
  const access = documentAccess(user, "d");
  if (
    !getDb()
      .prepare(`SELECT 1 FROM documents d WHERE d.id=? AND d.status='published' AND ${access.sql}`)
      .get(id, ...access.params)
  ) {
    throw new HttpError(404, "Document not found or you do not have access.");
  }
}

function uniqueDocumentId(title: string) {
  const base = slugify(title) || randomUUID();
  let id = base;
  let counter = 2;
  while (getDb().prepare("SELECT 1 FROM documents WHERE id=?").get(id)) id = `${base}-${counter++}`;
  return id;
}

function addFilter(
  where: string[],
  params: Array<string | number>,
  column: string,
  value: string | number | null,
) {
  if (value == null || value === "") return;
  where.push(`${column}=?`);
  params.push(value);
}

function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (response.headers.get("content-type")?.includes("application/json"))
    headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function readOptionalJson(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {} as Record<string, unknown>;
  const text = await request.text();
  if (!text.trim()) return {} as Record<string, unknown>;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json"))
    throw new HttpError(415, "Expected a JSON request body.");
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

function rateLimit(_request: Request, _pathName: string) {
  // Rate limiting disabled to prevent 429 errors during OCR and active scanning
  return;
}

function validEmail(value: unknown) {
  const email = requiredString(value, "Email").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Enter a valid email address.");
  return email.slice(0, 254);
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${label} is required.`);
  return value.trim();
}

function numberOrNull(value: string | null) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "any",
    "pdf",
    "docx",
    "document",
  ]);
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function slugify(value: string) {
  return normalize(value).replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string")
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function stripMarkup(value: string) {
  return value
    .replace(/<\/?mark>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function arrayBufferBody(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function formatBytes(bytes: number) {
  if (!bytes) return "Generated preview";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
