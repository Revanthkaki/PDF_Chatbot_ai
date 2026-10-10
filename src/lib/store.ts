import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Citation, Contract, Coverage, Evidence, Message, Segment } from "./types";

export const dataDirectory = () => process.env.DATA_DIR || path.join(process.cwd(), "data");
export class Store {
  db: Database.Database;
  constructor(directory: string) {
    mkdirSync(path.join(directory, "files"), { recursive: true });
    this.db = new Database(path.join(directory, "contracts.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing', error TEXT, created TEXT NOT NULL,
      pages INTEGER NOT NULL DEFAULT 0, characters INTEGER NOT NULL DEFAULT 0,
      segments TEXT NOT NULL DEFAULT '[]', text TEXT NOT NULL DEFAULT '', lease INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, progress INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, segment INTEGER NOT NULL, text TEXT NOT NULL, start INTEGER NOT NULL DEFAULT 0, end INTEGER NOT NULL DEFAULT 0);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_search USING fts5(text, content='chunks', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS chunk_insert AFTER INSERT ON chunks BEGIN INSERT INTO chunk_search(rowid,text) VALUES(new.id,new.text); END;
    CREATE TRIGGER IF NOT EXISTS chunk_delete AFTER DELETE ON chunks BEGIN INSERT INTO chunk_search(chunk_search,rowid,text) VALUES('delete',old.id,old.text); END;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '[]', activity TEXT NOT NULL DEFAULT '[]', coverage TEXT NOT NULL DEFAULT '[]', created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation,created);
    CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);`);
    const columns = this.db.prepare("PRAGMA table_info(chunks)").all() as { name: string }[];
    for (const name of ["start", "end"]) if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE chunks ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  }
  list() { return this.db.prepare("SELECT id,name,kind,status,error,created,pages,characters,progress FROM documents ORDER BY created DESC").all(); }
  get(id: string): Contract | undefined {
    const row = this.db.prepare("SELECT * FROM documents WHERE id=?").get(id) as (Omit<Contract, "segments"> & { segments: string }) | undefined;
    return row ? { ...row, segments: JSON.parse(row.segments) } : undefined;
  }
  byHash(hash: string) { return this.db.prepare("SELECT id,status FROM documents WHERE hash=?").get(hash) as { id: string; status: string } | undefined; }
  add(id: string, hash: string, name: string, kind: string) { this.db.prepare("INSERT INTO documents(id,hash,name,kind,created) VALUES(?,?,?,?,?)").run(id, hash, name, kind, new Date().toISOString()); }
  claim() {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE documents SET status='error',error='Processing failed after repeated attempts.' WHERE status='processing' AND attempts>=3 AND lease<?").run(Date.now());
      const row = this.db.prepare("SELECT id FROM documents WHERE status='processing' AND lease<? AND attempts<3 ORDER BY created LIMIT 1").get(Date.now()) as { id: string } | undefined;
      if (row) this.db.prepare("UPDATE documents SET lease=?,attempts=attempts+1 WHERE id=?").run(Date.now() + 20 * 60_000, row.id);
      return row?.id;
    })();
  }
  progress(id: string, progress: number) { this.db.prepare("UPDATE documents SET progress=? WHERE id=?").run(progress, id); }
  finish(id: string, segments: Segment[], text: string) {
    this.db.transaction(() => {
      if (!this.get(id)) return;
      this.db.prepare("DELETE FROM chunks WHERE document_id=?").run(id);
      const insert = this.db.prepare("INSERT INTO chunks(document_id,segment,text,start,end) VALUES(?,?,?,?,?)");
      for (const segment of segments) {
        for (let start = 0; start < segment.text.length;) {
          let end = Math.min(start + 2200, segment.text.length);
          if (end < segment.text.length) { const boundary = segment.text.lastIndexOf(" ", end); if (boundary > start + 1600) end = boundary; }
          insert.run(id, segment.number, segment.text.slice(start, end), segment.start + start, segment.start + end);
          if (end === segment.text.length) break;
          start = Math.max(start + 1, end - 350);
          while (start < end && !/\s/.test(segment.text[start])) start++;
        }
      }
      const emptyPages = this.get(id)?.kind === "pdf" ? segments.filter(segment => !segment.text.trim()).length : 0;
      const warning = emptyPages ? `${emptyPages} page(s) have no extractable text. Search cannot cover image-only or blank pages; OCR may be required.` : null;
      this.db.prepare("UPDATE documents SET status='ready',error=?,segments=?,text=?,pages=?,characters=?,progress=100 WHERE id=?").run(warning, JSON.stringify(segments), text, segments.length, text.length, id);
    })();
  }
  fail(id: string, error: string) { this.db.prepare("UPDATE documents SET status='error',error=? WHERE id=?").run(error.slice(0, 500), id); }
  delete(id: string) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
      const rows = this.db.prepare("SELECT DISTINCT conversation FROM messages").all() as { conversation: string }[];
      for (const row of rows) if (row.conversation.split(",").includes(id)) this.db.prepare("DELETE FROM messages WHERE conversation=?").run(row.conversation);
    })();
  }
  retrieve(query: string, ids: string[], limit = 6): { evidence: Evidence[]; coverage: Coverage[] } {
    const terms = [...new Set(query.match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 20);
    const aliases: Record<string, string[]> = { liability: ["cap", "damages"], termination: ["terminate", "notice"], fees: ["payment", "charges"], confidential: ["confidentiality"], indemnity: ["indemnify", "indemnification"], law: ["governing", "jurisdiction"] };
    for (const term of [...terms]) for (const related of aliases[term.toLowerCase()] || []) terms.push(related);
    const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const evidence: Evidence[] = [];
    const coverage: Coverage[] = [];
    for (const id of ids) {
      const doc = this.get(id);
      if (!doc) continue;
      const count = this.db.prepare("SELECT count(*) AS count FROM chunks WHERE document_id=?").get(id) as { count: number };
      const rows = match ? this.db.prepare("SELECT c.id,c.segment,c.text,c.start,c.end FROM chunk_search f JOIN chunks c ON c.id=f.rowid WHERE chunk_search MATCH ? AND c.document_id=? ORDER BY bm25(chunk_search) LIMIT ?").all(match, id, limit) as { id: number; segment: number; text: string; start: number; end: number }[] : [];
      evidence.push(...rows.map(row => ({ documentId: id, documentName: doc.name, segment: row.segment, text: row.text, chunkId: row.id, start: row.start, end: row.end })));
      coverage.push({ documentId: id, name: doc.name, totalChunks: count.count, retrievedChunks: rows.length, indexed: doc.status === "ready" && !doc.error, fullyExamined: doc.status === "ready" && !doc.error && rows.length === count.count && count.count > 0 });
    }
    return { evidence, coverage };
  }
  section(id: string, number: number): Evidence[] {
    const document = this.get(id);
    if (!document) return [];
    return (this.db.prepare("SELECT id,segment,text,start,end FROM chunks WHERE document_id=? AND segment=? ORDER BY id LIMIT 10").all(id, number) as { id: number; segment: number; text: string; start: number; end: number }[]).map(row => ({ documentId: id, documentName: document.name, segment: row.segment, text: row.text, chunkId: row.id, start: row.start, end: row.end }));
  }
  history(ids: string[]): Message[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE conversation=? ORDER BY created,rowid").all([...ids].sort().join(",")) as (Omit<Message, "citations" | "activity" | "coverage"> & { citations: string; activity: string; coverage: string })[];
    return rows.map(row => ({ ...row, citations: JSON.parse(row.citations), activity: JSON.parse(row.activity), coverage: JSON.parse(row.coverage) }));
  }
  message(ids: string[], role: "user" | "assistant", content: string) {
    const id = randomUUID();
    this.db.prepare("INSERT INTO messages(id,conversation,role,content,status,created) VALUES(?,?,?,?,?,?)").run(id, [...ids].sort().join(","), role, content, role === "user" ? "complete" : "streaming", new Date().toISOString());
    return id;
  }
  saveMessage(id: string, content: string, status: string, citations: Citation[] = [], activity: string[] = [], coverage: Coverage[] = []) { this.db.prepare("UPDATE messages SET content=?,status=?,citations=?,activity=?,coverage=? WHERE id=?").run(content, status, JSON.stringify(citations), JSON.stringify(activity), JSON.stringify(coverage), id); }
}
let singleton: Store | undefined;
export function store() { return singleton ??= new Store(dataDirectory()); }