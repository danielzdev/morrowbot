/**
 * Migration 9 (queued messages). Messages sent while a turn runs wait here until the agent sees them;
 * delivering one moves it into `messages` under the same id.
 */
export const MIGRATION_9 = `
  CREATE TABLE queued_messages (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX queued_messages_by_thread ON queued_messages(thread_id, seq);
`;
