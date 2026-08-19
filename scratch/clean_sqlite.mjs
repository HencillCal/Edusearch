import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const dbPath = path.join(dataDir, "edusearch.sqlite");

try {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    DELETE FROM documents WHERE id IN ('python-oop-practical-2025','oop-notes-python','ai-past-paper-2025','dbms-past-paper','graphic-design-marking-scheme','networking-notes','entrepreneurship-marking-scheme','electrical-practical-manual','accounting-cat','java-cat-2024');
    DELETE FROM document_fts WHERE document_id IN ('python-oop-practical-2025','oop-notes-python','ai-past-paper-2025','dbms-past-paper','graphic-design-marking-scheme','networking-notes','entrepreneurship-marking-scheme','electrical-practical-manual','accounting-cat','java-cat-2024');
    DELETE FROM document_chunks WHERE document_id IN ('python-oop-practical-2025','oop-notes-python','ai-past-paper-2025','dbms-past-paper','graphic-design-marking-scheme','networking-notes','entrepreneurship-marking-scheme','electrical-practical-manual','accounting-cat','java-cat-2024');
    DELETE FROM search_logs;
    DELETE FROM download_logs;
    DELETE FROM audit_logs;
  `);
  console.log("Database cleared of seed documents and fake logs.");
} catch (e) {
  console.error("Error cleaning database:", e);
}
