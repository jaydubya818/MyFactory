import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Actor, Feedback, FeedbackDetail, FeedbackEvent, FeedbackNote, FeedbackPriority, FeedbackSource,
  FeedbackStatus,
} from "../src/shared/actions.ts";

export class NotFoundError extends Error {
  readonly status = 404;
}

export class ConflictError extends Error {
  readonly status = 409;
}

interface FeedbackRow {
  id: string;
  title: string;
  description: string;
  source: FeedbackSource;
  customer: string;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  version: number;
  created_at: string;
  updated_at: string;
  note_count: number;
}

interface NoteRow {
  id: string;
  feedback_id: string;
  body: string;
  actor: Actor;
  created_at: string;
}

interface EventRow {
  id: number;
  feedback_id: string;
  actor: Actor;
  summary: string;
  created_at: string;
}

function feedbackFromRow(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    customer: row.customer,
    status: row.status,
    priority: row.priority,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    noteCount: row.note_count,
  };
}

export class FeedbackStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('manual','support','interview','in_app')),
        customer TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('new','reviewing','planned','closed')),
        priority TEXT NOT NULL CHECK (priority IN ('unset','low','medium','high')),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback_notes (
        id TEXT PRIMARY KEY,
        feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('user','agent')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
        actor TEXT NOT NULL CHECK (actor IN ('user','agent')),
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_status_updated ON feedback(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS notes_feedback_time ON feedback_notes(feedback_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS events_feedback_id ON feedback_events(feedback_id, id DESC);
    `);
  }

  close(): void { this.#db.close(); }

  #transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  list(search = "", status: FeedbackStatus | "all" = "all"): Feedback[] {
    const term = `%${search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.#db.prepare(`
      SELECT f.*, (SELECT COUNT(*) FROM feedback_notes n WHERE n.feedback_id = f.id) AS note_count
      FROM feedback f
      WHERE (? = 'all' OR f.status = ?)
        AND (LOWER(f.title) LIKE ? ESCAPE '\\' OR LOWER(f.description) LIKE ? ESCAPE '\\'
          OR LOWER(f.customer) LIKE ? ESCAPE '\\')
      ORDER BY f.updated_at DESC, f.id DESC
    `).all(status, status, term, term, term) as unknown as FeedbackRow[];
    return rows.map(feedbackFromRow);
  }

  get(id: string): FeedbackDetail {
    const row = this.#db.prepare(`
      SELECT f.*, (SELECT COUNT(*) FROM feedback_notes n WHERE n.feedback_id = f.id) AS note_count
      FROM feedback f WHERE f.id = ?
    `).get(id) as FeedbackRow | undefined;
    if (!row) throw new NotFoundError("Feedback was not found.");
    const notes = (this.#db.prepare("SELECT * FROM feedback_notes WHERE feedback_id = ? ORDER BY created_at DESC, id DESC")
      .all(id) as unknown as NoteRow[]).map((note): FeedbackNote => ({
      id: note.id, feedbackId: note.feedback_id, body: note.body, actor: note.actor, createdAt: note.created_at,
    }));
    const events = (this.#db.prepare("SELECT * FROM feedback_events WHERE feedback_id = ? ORDER BY id DESC")
      .all(id) as unknown as EventRow[]).map((event): FeedbackEvent => ({
      id: event.id, feedbackId: event.feedback_id, actor: event.actor, summary: event.summary, createdAt: event.created_at,
    }));
    return { ...feedbackFromRow(row), notes, events };
  }

  create(input: { title: string; description: string; source: FeedbackSource; customer?: string }, actor: Actor): FeedbackDetail {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO feedback (id, title, description, source, customer, status, priority, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'new', 'unset', 1, ?, ?)
      `).run(id, input.title, input.description, input.source, input.customer ?? "", now, now);
      this.#db.prepare("INSERT INTO feedback_events (feedback_id, actor, summary, created_at) VALUES (?, ?, ?, ?)")
        .run(id, actor, "Captured feedback", now);
    });
    return this.get(id);
  }

  update(input: {
    id: string;
    expectedVersion: number;
    changes: Partial<Pick<Feedback, "title" | "description" | "source" | "customer" | "status" | "priority">>;
  }, actor: Actor): FeedbackDetail {
    const current = this.get(input.id);
    if (current.version !== input.expectedVersion) throw new ConflictError("Feedback changed. Refresh it before saving.");
    const changed = Object.keys(input.changes).filter((key) =>
      current[key as keyof Feedback] !== input.changes[key as keyof typeof input.changes]);
    if (changed.length === 0) return current;
    const next = { ...current, ...input.changes };
    const now = new Date().toISOString();
    this.#transaction(() => {
      const result = this.#db.prepare(`
        UPDATE feedback SET title = ?, description = ?, source = ?, customer = ?, status = ?, priority = ?,
          version = version + 1, updated_at = ? WHERE id = ? AND version = ?
      `).run(next.title, next.description, next.source, next.customer, next.status, next.priority,
        now, input.id, input.expectedVersion);
      if (result.changes !== 1) throw new ConflictError("Feedback changed. Refresh it before saving.");
      this.#db.prepare("INSERT INTO feedback_events (feedback_id, actor, summary, created_at) VALUES (?, ?, ?, ?)")
        .run(input.id, actor, `Updated ${changed.join(", ")}`, now);
    });
    return this.get(input.id);
  }

  addNote(input: { id: string; body: string }, actor: Actor): FeedbackDetail {
    this.get(input.id);
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#db.prepare("INSERT INTO feedback_notes (id, feedback_id, body, actor, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), input.id, input.body, actor, now);
      this.#db.prepare("UPDATE feedback SET version = version + 1, updated_at = ? WHERE id = ?").run(now, input.id);
      this.#db.prepare("INSERT INTO feedback_events (feedback_id, actor, summary, created_at) VALUES (?, ?, ?, ?)")
        .run(input.id, actor, "Added an internal note", now);
    });
    return this.get(input.id);
  }
}
