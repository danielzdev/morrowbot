/**
 * Migration 7 (attachments and memories). An attachment is uploaded to a thread and joins a user
 * message when it is sent; its bytes live in the data folder's `attachments/`, named by id. A
 * memory belongs to one agent; `memories_fts` indexes its text for keyword search.
 */
export const MIGRATION_7 = `
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'text')),
    name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX attachments_by_thread ON attachments(thread_id, message_id, position);
  CREATE TABLE memories (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    inclusion TEXT NOT NULL CHECK (inclusion IN ('essential', 'searchable')),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX memories_by_agent ON memories(agent_id, created_at);
  CREATE VIRTUAL TABLE memories_fts USING fts5(text, content='memories', content_rowid='seq', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, text) VALUES (new.seq, new.text);
  END;
  CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.seq, old.text);
  END;
  CREATE TRIGGER memories_fts_update AFTER UPDATE OF text ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.seq, old.text);
    INSERT INTO memories_fts(rowid, text) VALUES (new.seq, new.text);
  END;
`;
