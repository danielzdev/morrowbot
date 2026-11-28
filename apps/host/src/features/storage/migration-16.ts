/**
 * Migration 16 (tool steps in chat history). Each tool call a turn makes is saved as it starts and ends, so a reload
 * or a host restart keeps it. A step belongs to its turn and, once the turn's reply is saved, to that reply; ordering
 * is `seq`. Only `ok` and `error` carry an end time.
 */
export const MIGRATION_16 = `
  CREATE TABLE tool_steps (
    seq INTEGER PRIMARY KEY,
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    tool_use_id TEXT NOT NULL,
    name TEXT NOT NULL,
    input TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('running', 'ok', 'error', 'unfinished')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    CHECK ((outcome IN ('ok', 'error')) = (ended_at IS NOT NULL)),
    UNIQUE (generation_id, tool_use_id)
  ) STRICT;
  CREATE INDEX tool_steps_by_message ON tool_steps(message_id) WHERE message_id IS NOT NULL;
`;
