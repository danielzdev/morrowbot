/**
 * Migration 17 (reply attachments). A file an agent attaches with `attach_files` is copied into the data folder's
 * `reply-attachments/`, named by id, and saved here with its turn. Once the turn's reply is saved it belongs to that
 * reply; a turn that adds no reply drops it. Ordering is `seq`.
 */
export const MIGRATION_17 = `
  CREATE TABLE reply_attachments (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file')),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX reply_attachments_by_message ON reply_attachments(message_id, seq) WHERE message_id IS NOT NULL;
  CREATE INDEX reply_attachments_open ON reply_attachments(generation_id, seq) WHERE message_id IS NULL;
`;
