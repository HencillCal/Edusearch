import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  documents as seedDocuments,
  subjects as seedSubjects,
  synonyms as seedSynonyms,
} from "../lib/edusearch-data";

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "edusearch.sqlite"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

let initialized = false;

export function getDb() {
  if (!initialized) initializeDatabase();
  return db;
}

export function initializeDatabase() {
  if (initialized) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      synonyms_json TEXT NOT NULL DEFAULT '[]',
      related_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS document_topics (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY(document_id, topic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_document_topics_topic ON document_topics(topic_id);
    CREATE INDEX IF NOT EXISTS idx_document_topics_doc ON document_topics(document_id);

    CREATE TABLE IF NOT EXISTS document_processing_cache (
      sha256 TEXT PRIMARY KEY,
      extracted_text TEXT NOT NULL,
      pages INTEGER NOT NULL DEFAULT 1,
      file_type TEXT NOT NULL,
      suggestions_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      topics_json TEXT NOT NULL DEFAULT '[]',
      doc_type TEXT NOT NULL,
      year INTEGER,
      level TEXT NOT NULL DEFAULT 'Unspecified',
      language TEXT NOT NULL DEFAULT 'English',
      file_type TEXT NOT NULL,
      pages INTEGER NOT NULL DEFAULT 1,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      institution TEXT,
      author TEXT,
      upload_source TEXT NOT NULL DEFAULT 'web',
      description TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      original_filename TEXT,
      storage_path TEXT,
      preview_path TEXT,
      sha256 TEXT,
      extracted_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'awaiting_review' CHECK(status IN ('draft','uploaded','processing','awaiting_review','changes_requested','approved','rejected','published','archived')),
      preview_status TEXT NOT NULL DEFAULT 'available',
      download_status TEXT NOT NULL DEFAULT 'allowed',
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','library')),
      library_id TEXT,
      rejection_reason TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 0,
      uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      original_source_path TEXT,
      docx_storage_path TEXT,
      structure_json TEXT NOT NULL DEFAULT '{}',
      ocr_job_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_subject ON documents(subject);
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);

    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      document_id UNINDEXED,
      title,
      subject,
      topics,
      doc_type,
      description,
      keywords,
      content,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS document_embeddings (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_document_embeddings_model ON document_embeddings(model);


    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      page_number INTEGER NOT NULL DEFAULT 1,
      heading TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      character_start INTEGER NOT NULL DEFAULT 0,
      character_end INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id, page_number, chunk_index);

    CREATE VIRTUAL TABLE IF NOT EXISTS document_chunk_fts USING fts5(
      chunk_id UNINDEXED,
      document_id UNINDEXED,
      heading,
      content,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS staged_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_type TEXT NOT NULL,
      staging_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      extracted_text TEXT NOT NULL DEFAULT '',
      pages INTEGER NOT NULL DEFAULT 1,
      suggestions_json TEXT NOT NULL DEFAULT '{}',
      duplicate_json TEXT NOT NULL DEFAULT '{}',
      virus_scan TEXT NOT NULL DEFAULT 'not_scanned',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saved_documents (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collection_documents (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(collection_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS followed_topics (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, topic_name)
    );

    CREATE TABLE IF NOT EXISTS document_ratings (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS document_reports (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','dismissed')),
      resolution_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_document_reports_status ON document_reports(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS search_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      normalized_query TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS download_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ocr_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_paths_json TEXT NOT NULL DEFAULT '[]',
      source_filenames_json TEXT NOT NULL DEFAULT '[]',
      combine_as_document INTEGER NOT NULL DEFAULT 1,
      enhanced_paths_json TEXT NOT NULL DEFAULT '[]',
      extracted_text TEXT NOT NULL DEFAULT '',
      corrected_text TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      quality_score REAL NOT NULL DEFAULT 0,
      ocr_profile TEXT NOT NULL DEFAULT 'exam',
      ocr_language TEXT NOT NULL DEFAULT 'eng',
      ocr_quality_mode TEXT NOT NULL DEFAULT 'accurate',
      pipeline_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      structure_json TEXT NOT NULL DEFAULT '{"version":1,"pages":[]}',
      revision INTEGER NOT NULL DEFAULT 1,
      published_document_id TEXT,
      rights_basis TEXT NOT NULL DEFAULT 'unspecified',
      source_attribution TEXT NOT NULL DEFAULT '',
      rights_declared INTEGER NOT NULL DEFAULT 0,
      rights_declared_by TEXT,
      rights_declared_at TEXT,
      processing_stage TEXT NOT NULL DEFAULT 'uploaded',
      progress INTEGER NOT NULL DEFAULT 0,
      pages_completed INTEGER NOT NULL DEFAULT 0,
      total_pages INTEGER NOT NULL DEFAULT 1,
      current_stage TEXT NOT NULL DEFAULT 'Upload received',
      status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','awaiting_correction','ready','published','failed')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ocr_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      corrected_text TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      structure_json TEXT NOT NULL DEFAULT '{"version":1,"pages":[]}',
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_revisions_job ON ocr_revisions(job_id, revision DESC);

    CREATE TABLE IF NOT EXISTS ocr_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      original_filename TEXT NOT NULL DEFAULT '',
      original_path TEXT,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      enhanced_path TEXT,
      raw_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      diagnostics_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, page_number)
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_pages_job ON ocr_pages(job_id, page_number);

    CREATE TABLE IF NOT EXISTS ocr_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL REFERENCES ocr_pages(id) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      agreement REAL NOT NULL DEFAULT 1,
      needs_review INTEGER NOT NULL DEFAULT 0,
      UNIQUE(page_id, line_number)
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_lines_page ON ocr_lines(page_id, line_number);

    CREATE TABLE IF NOT EXISTS ocr_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL REFERENCES ocr_lines(id) ON DELETE CASCADE,
      word_number INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      page_number INTEGER NOT NULL DEFAULT 1,
      line_number INTEGER NOT NULL DEFAULT 1,
      UNIQUE(line_id, word_number)
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_words_line ON ocr_words(line_id, word_number);

    CREATE TABLE IF NOT EXISTS ocr_blocks (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      block_order INTEGER NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      reviewed INTEGER NOT NULL DEFAULT 0,
      marks INTEGER,
      question_number TEXT,
      bbox_json TEXT,
      structure_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(job_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_blocks_job ON ocr_blocks(job_id, page_number, block_order);

    CREATE TABLE IF NOT EXISTS ocr_preflight_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      ready INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      checks_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_preflight_job ON ocr_preflight_results(job_id, revision DESC);

    CREATE TABLE IF NOT EXISTS ocr_exports (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      format TEXT NOT NULL,
      mode TEXT NOT NULL,
      path TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_exports_job ON ocr_exports(job_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS document_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      source_path TEXT,
      pdf_path TEXT,
      extracted_text TEXT NOT NULL DEFAULT '',
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, page_number)
    );
    CREATE INDEX IF NOT EXISTS idx_document_pages_document ON document_pages(document_id, page_number);

    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      institution TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('public','private')),
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      join_code_hash TEXT NOT NULL UNIQUE,
      join_code_hint TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_libraries_visibility ON libraries(visibility, created_at DESC);

    CREATE TABLE IF NOT EXISTS library_members (
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner','editor','viewer')),
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(library_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_library_members_user ON library_members(user_id, joined_at DESC);

    CREATE TABLE IF NOT EXISTS library_documents (
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(library_id, document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_library_documents_document ON library_documents(document_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS copyright_requests (
      id TEXT PRIMARY KEY,
      tracking_hash TEXT NOT NULL UNIQUE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      claimant_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      claimant_name TEXT NOT NULL,
      claimant_email TEXT NOT NULL,
      claimant_organization TEXT NOT NULL DEFAULT '',
      relationship TEXT NOT NULL CHECK(relationship IN ('author','rights_holder','authorized_representative','institution','other')),
      requested_action TEXT NOT NULL DEFAULT 'remove' CHECK(requested_action IN ('remove','restrict','contact_uploader')),
      statement TEXT NOT NULL,
      evidence_filename TEXT,
      evidence_path TEXT,
      evidence_mime TEXT,
      evidence_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','reviewing','restricted','resolved','dismissed')),
      resolution_action TEXT NOT NULL DEFAULT 'none' CHECK(resolution_action IN ('none','restored','removed','kept_restricted','contacted_uploader')),
      resolution_note TEXT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_copyright_requests_status ON copyright_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_copyright_requests_document ON copyright_requests(document_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','resolved','spam')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status, created_at DESC);
  `);

  ensureColumn("documents", "visibility", "TEXT NOT NULL DEFAULT 'public'");
  ensureColumn("documents", "library_id", "TEXT");
  ensureColumn("documents", "rights_basis", "TEXT NOT NULL DEFAULT 'unspecified'");
  ensureColumn("documents", "source_attribution", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("documents", "rights_status", "TEXT NOT NULL DEFAULT 'clear'");
  ensureColumn("documents", "rights_restriction_note", "TEXT");
  ensureColumn("documents", "original_source_path", "TEXT");
  ensureColumn("documents", "docx_storage_path", "TEXT");
  ensureColumn("documents", "structure_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("documents", "ocr_job_id", "TEXT");
  ensureColumn("ocr_jobs", "source_paths_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("ocr_jobs", "source_filenames_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("ocr_jobs", "combine_as_document", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("ocr_jobs", "processing_stage", "TEXT NOT NULL DEFAULT 'uploaded'");
  ensureColumn("ocr_jobs", "progress", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("ocr_jobs", "pages_completed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("ocr_jobs", "total_pages", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("ocr_jobs", "current_stage", "TEXT NOT NULL DEFAULT 'Upload received'");
  ensureColumn("ocr_jobs", "diagnostics_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("ocr_jobs", "document_type", "TEXT NOT NULL DEFAULT 'mixed'");
  ensureColumn("ocr_pages", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("ocr_pages", "original_filename", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("ocr_pages", "original_path", "TEXT");
  ensureColumn("ocr_pages", "status", "TEXT NOT NULL DEFAULT 'success'");
  ensureColumn("ocr_pages", "error_message", "TEXT");
  ensureColumn("ocr_jobs", "structure_json", `TEXT NOT NULL DEFAULT '{"version":1,"pages":[]}'`);
  ensureColumn("ocr_jobs", "revision", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("ocr_jobs", "published_document_id", "TEXT");
  ensureColumn("ocr_jobs", "rights_basis", "TEXT NOT NULL DEFAULT 'unspecified'");
  ensureColumn("ocr_jobs", "source_attribution", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("ocr_jobs", "rights_declared", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("ocr_jobs", "rights_declared_by", "TEXT");
  ensureColumn("ocr_jobs", "rights_declared_at", "TEXT");
  ensureColumn("ocr_jobs", "quality_score", "REAL NOT NULL DEFAULT 0");
  ensureColumn("ocr_jobs", "ocr_profile", "TEXT NOT NULL DEFAULT 'exam'");
  ensureColumn("ocr_jobs", "ocr_language", "TEXT NOT NULL DEFAULT 'eng'");
  ensureColumn("ocr_jobs", "ocr_quality_mode", "TEXT NOT NULL DEFAULT 'accurate'");
  ensureColumn("ocr_jobs", "pipeline_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("documents", "thumbnail_path", "TEXT");
  ensureColumn("documents", "thumbnail_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("documents", "thumbnail_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("topics", "show_in_browse", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("libraries", "join_code_encrypted", "TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility, library_id, status);",
  );
  db.exec(`
    INSERT OR IGNORE INTO ocr_revisions(job_id,revision,corrected_text,metadata_json,structure_json,note,created_by,created_at)
    SELECT id,COALESCE(revision,1),corrected_text,metadata_json,structure_json,'Migrated OCR state',user_id,created_at
    FROM ocr_jobs
    WHERE status <> 'processing'
  `);

  // Provider infrastructure tables (added by provider upgrade)
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_routes (
      capability  TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id    TEXT,
      priority    INTEGER NOT NULL DEFAULT 1,
      enabled     INTEGER NOT NULL DEFAULT 1,
      cost_tier   TEXT,
      PRIMARY KEY (capability, provider_id)
    );

    CREATE TABLE IF NOT EXISTS provider_models_cache (
      provider_id    TEXT NOT NULL,
      model_id       TEXT NOT NULL,
      display_name   TEXT,
      capabilities   TEXT,
      context_length INTEGER,
      cached_at      INTEGER NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    );
  `);

  initialized = true;
  seedBaseData();
  cleanupExpiredData();
  return db;
}

export function refreshDocumentFts(documentId: string) {
  const database = getDb();
  const row = database.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as
    Record<string, unknown> | undefined;
  database.prepare("DELETE FROM document_fts WHERE document_id = ?").run(documentId);
  clearDocumentChunks(documentId);
  if (
    !row ||
    row.status !== "published" ||
    ["restricted", "removed"].includes(String(row.rights_status || "clear"))
  )
    return;
  database
    .prepare(
      `
    INSERT INTO document_fts(document_id,title,subject,topics,doc_type,description,keywords,content)
    VALUES(?,?,?,?,?,?,?,?)
  `,
    )
    .run(
      String(row.id),
      String(row.title),
      String(row.subject),
      jsonArray(row.topics_json).join(" "),
      String(row.doc_type),
      String(row.description || ""),
      jsonArray(row.keywords_json).join(" "),
      String(row.extracted_text || ""),
    );
  syncDocumentTopics(String(row.id), String(row.subject), jsonArray(row.topics_json));
  refreshDocumentChunks(documentId, row);
}

export function resolveTaxonomy(
  subjectOrTopic: string,
  rawTopics: string[] = [],
): { subject: string; topicIds: number[]; topicNames: string[] } {
  const database = getDb();
  const allTopicRows = database
    .prepare(
      "SELECT t.id, t.name, t.synonyms_json, t.subject_id, s.name as subject_name FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id",
    )
    .all() as Array<{
    id: number;
    name: string;
    synonyms_json: string;
    subject_id: number | null;
    subject_name: string | null;
  }>;
  const subjectRows = database.prepare("SELECT id, name FROM subjects").all() as Array<{
    id: number;
    name: string;
  }>;

  const candidates = [subjectOrTopic, ...rawTopics].filter(Boolean);
  let resolvedSubject = "";
  const topicIds = new Set<number>();
  const topicNames = new Set<string>();

  const directSubject = subjectRows.find(
    (s) => s.name.toLowerCase() === subjectOrTopic.trim().toLowerCase(),
  );
  if (directSubject) {
    resolvedSubject = directSubject.name;
  }

  for (const item of candidates) {
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) continue;
    for (const t of allTopicRows) {
      const matchName = t.name.toLowerCase() === trimmed;
      const synonyms = jsonArray(t.synonyms_json).map((s) => s.toLowerCase());
      const matchSyn = synonyms.includes(trimmed);
      if (matchName || matchSyn) {
        topicIds.add(t.id);
        topicNames.add(t.name);
        if (!resolvedSubject && t.subject_name) {
          resolvedSubject = t.subject_name;
        }
      }
    }
  }

  if (!resolvedSubject) {
    resolvedSubject = subjectOrTopic || "Computing";
  }

  return {
    subject: resolvedSubject,
    topicIds: Array.from(topicIds),
    topicNames: Array.from(topicNames),
  };
}

export function syncDocumentTopics(documentId: string, subject: string, topics: string[]) {
  const database = getDb();
  const taxonomy = resolveTaxonomy(subject, topics);
  const insert = database.prepare(
    "INSERT OR IGNORE INTO document_topics(document_id, topic_id) VALUES(?, ?)",
  );
  for (const topicId of taxonomy.topicIds) {
    insert.run(documentId, topicId);
  }
  return taxonomy;
}

export function refreshDocumentChunks(documentId: string, suppliedRow?: Record<string, unknown>) {
  const database = getDb();
  const row =
    suppliedRow ??
    (database.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as
      Record<string, unknown> | undefined);
  clearDocumentChunks(documentId);
  if (
    !row ||
    row.status !== "published" ||
    ["restricted", "removed"].includes(String(row.rights_status || "clear"))
  )
    return 0;

  const source = String(row.extracted_text || row.description || row.title || "").trim();
  const chunks = splitDocumentIntoChunks(source, Number(row.pages || 1));
  const insertChunk = database.prepare(`
    INSERT INTO document_chunks(document_id,chunk_index,page_number,heading,content,character_start,character_end)
    VALUES(?,?,?,?,?,?,?)
  `);
  const insertFts = database.prepare(`
    INSERT INTO document_chunk_fts(chunk_id,document_id,heading,content) VALUES(?,?,?,?)
  `);
  for (const chunk of chunks) {
    const result = insertChunk.run(
      documentId,
      chunk.index,
      chunk.page,
      chunk.heading,
      chunk.content,
      chunk.start,
      chunk.end,
    );
    insertFts.run(Number(result.lastInsertRowid), documentId, chunk.heading, chunk.content);
  }
  return chunks.length;
}

export function rebuildDocumentChunkIndex() {
  const database = getDb();
  database.prepare("DELETE FROM document_chunk_fts").run();
  database.prepare("DELETE FROM document_chunks").run();
  const rows = database.prepare("SELECT * FROM documents WHERE status='published'").all() as Array<
    Record<string, unknown>
  >;
  let chunks = 0;
  for (const row of rows) chunks += refreshDocumentChunks(String(row.id), row);
  return { documents: rows.length, chunks };
}

function clearDocumentChunks(documentId: string) {
  const database = getDb();
  const ids = database
    .prepare("SELECT id FROM document_chunks WHERE document_id=?")
    .all(documentId) as Array<{ id: number }>;
  const removeFts = database.prepare("DELETE FROM document_chunk_fts WHERE chunk_id=?");
  for (const item of ids) removeFts.run(item.id);
  database.prepare("DELETE FROM document_chunks WHERE document_id=?").run(documentId);
}

type DocumentChunk = {
  index: number;
  page: number;
  heading: string;
  content: string;
  start: number;
  end: number;
};

export function splitDocumentIntoChunks(text: string, declaredPages = 1): DocumentChunk[] {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n?---\s*PAGE BREAK\s*---\n?/gi, "\f")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
  if (!normalized) return [];

  const explicitPages = normalized
    .split(/\f+/)
    .map((page) => page.trim())
    .filter(Boolean);
  const pages = explicitPages.length > 1 ? explicitPages : [normalized];
  const chunks: DocumentChunk[] = [];
  let globalOffset = 0;
  const maxChars = 1500;
  const overlapChars = 180;

  pages.forEach((pageText, pageIndex) => {
    const blocks = pageText
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);
    const pageNumber =
      explicitPages.length > 1
        ? pageIndex + 1
        : Math.min(
            Math.max(1, declaredPages),
            Math.max(1, Math.floor((pageIndex / Math.max(pages.length, 1)) * declaredPages) + 1),
          );
    let buffer = "";
    let bufferStart = globalOffset;

    const pushBuffer = () => {
      const content = buffer.trim();
      if (!content) return;
      const heading = detectChunkHeading(content);
      chunks.push({
        index: chunks.length,
        page: pageNumber,
        heading,
        content,
        start: bufferStart,
        end: bufferStart + content.length,
      });
      const overlap = content.slice(-overlapChars);
      buffer = overlap;
      bufferStart = Math.max(bufferStart, bufferStart + content.length - overlap.length);
    };

    for (const block of blocks.length ? blocks : [pageText]) {
      if (block.length > maxChars) {
        const sentences = block.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
        for (const sentence of sentences) {
          if (buffer && buffer.length + sentence.length + 1 > maxChars) pushBuffer();
          buffer += `${buffer ? " " : ""}${sentence}`;
        }
        continue;
      }
      if (buffer && buffer.length + block.length + 2 > maxChars) pushBuffer();
      buffer += `${buffer ? "\n\n" : ""}${block}`;
    }
    if (buffer.trim()) {
      const content = buffer.trim();
      chunks.push({
        index: chunks.length,
        page: pageNumber,
        heading: detectChunkHeading(content),
        content,
        start: bufferStart,
        end: bufferStart + content.length,
      });
    }
    globalOffset += pageText.length + 1;
  });

  if (explicitPages.length === 1 && declaredPages > 1 && chunks.length > 1) {
    chunks.forEach((chunk, index) => {
      chunk.page = Math.min(declaredPages, Math.floor((index * declaredPages) / chunks.length) + 1);
    });
  }
  return chunks;
}

function detectChunkHeading(content: string) {
  const firstLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || "";
  if (
    firstLine.length <= 120 &&
    (/^(section|part|question|chapter|unit|topic)\b/i.test(firstLine) ||
      /^[A-Z0-9 .:()/-]{4,}$/.test(firstLine))
  ) {
    return firstLine.slice(0, 140);
  }
  return "";
}

export function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function jsonObject<T extends Record<string, unknown>>(
  value: unknown,
  fallback = {} as T,
): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function seedBaseData() {
  const database = db;
  const subjectInsert = database.prepare(
    "INSERT OR IGNORE INTO subjects(name, description) VALUES(?, ?)",
  );
  const topicInsert = database.prepare(
    "INSERT OR IGNORE INTO topics(subject_id, name, description, synonyms_json, related_json) VALUES(?, ?, '', ?, '[]')",
  );

  for (const subject of seedSubjects) {
    subjectInsert.run(subject.name, `${subject.name} academic documents and course material.`);
    const row = database.prepare("SELECT id FROM subjects WHERE name = ?").get(subject.name) as {
      id: number;
    };
    for (const topic of subject.topics) {
      const synonyms = seedSynonyms[topic.toLowerCase()] ?? [];
      topicInsert.run(row.id, topic, JSON.stringify(synonyms));
    }
  }

  for (const [name, synonyms] of Object.entries(seedSynonyms)) {
    topicInsert.run(null, name, JSON.stringify(synonyms));
  }

  const count = (
    database.prepare("SELECT COUNT(*) AS count FROM documents").get() as { count: number }
  ).count;
  if (count === 0) {
    const insert = database.prepare(`
      INSERT INTO documents(
        id,title,subject,topics_json,doc_type,year,level,language,file_type,pages,size_bytes,
        institution,author,description,keywords_json,extracted_text,status,views,downloads,rating,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const document of seedDocuments) {
      const createdAt = new Date(Date.now() - document.addedDaysAgo * 86_400_000).toISOString();
      insert.run(
        document.id,
        document.title,
        document.subject,
        JSON.stringify(document.topics),
        document.docType,
        document.year,
        document.level,
        document.language,
        document.fileType,
        document.pages,
        parseSize(document.size),
        document.institution ?? null,
        document.author ?? null,
        document.description,
        JSON.stringify(document.keywords),
        `${document.title}\n\n${document.description}\n\n${document.snippet}`,
        "published",
        Math.floor(document.downloads * 1.7),
        document.downloads,
        document.rating,
        createdAt,
        createdAt,
      );
      refreshDocumentFts(document.id);
    }
  } else {
    const published = database
      .prepare("SELECT id FROM documents WHERE status = 'published'")
      .all() as Array<{ id: string }>;
    const ftsCount = (
      database.prepare("SELECT COUNT(*) AS count FROM document_fts").get() as { count: number }
    ).count;
    if (ftsCount === 0) published.forEach((row) => refreshDocumentFts(row.id));
    else {
      const missingChunks = database
        .prepare(
          `
        SELECT d.id FROM documents d
        WHERE d.status='published' AND NOT EXISTS (
          SELECT 1 FROM document_chunks c WHERE c.document_id=d.id
        )
      `,
        )
        .all() as Array<{ id: string }>;
      missingChunks.forEach((row) => refreshDocumentChunks(row.id));
    }
  }

  const allDocs = database
    .prepare("SELECT id, subject, topics_json FROM documents")
    .all() as Array<{ id: string; subject: string; topics_json: string }>;
  for (const doc of allDocs) {
    syncDocumentTopics(doc.id, doc.subject, jsonArray(doc.topics_json));
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminHash = process.env.SEED_ADMIN_PASSWORD_HASH;
  if (adminEmail && adminHash) {
    database
      .prepare(
        "INSERT OR IGNORE INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?, 'admin')",
      )
      .run(randomUUID(), "EduSearch Administrator", adminEmail, adminHash);
  }
}

function cleanupExpiredData() {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  const expired = db
    .prepare("SELECT staging_path FROM staged_uploads WHERE expires_at < ?")
    .all(now) as Array<{ staging_path: string }>;
  expired.forEach((item) => {
    try {
      rmSync(item.staging_path, { force: true });
    } catch {
      // Cleanup is best-effort; a locked file must not prevent database startup.
    }
  });
  db.prepare("DELETE FROM staged_uploads WHERE expires_at < ?").run(now);
}

function parseSize(size: string): number {
  const match = size.match(/[\d.]+/);
  const value = match ? Number(match[0]) : 0;
  if (/GB/i.test(size)) return Math.round(value * 1024 ** 3);
  if (/MB/i.test(size)) return Math.round(value * 1024 ** 2);
  if (/KB/i.test(size)) return Math.round(value * 1024);
  return Math.round(value);
}
