/**
 * Migration 14 (sub-agents). A sub-agent's turn runs in its own chat, a child of the chat whose turn started it:
 * hidden from the agent's chat list and deleted with its parent. `subagent_runs` keeps who started it and how.
 */
export const MIGRATION_14 = `
  ALTER TABLE threads ADD COLUMN parent_thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE;
  CREATE INDEX threads_by_parent ON threads(parent_thread_id);

  CREATE TABLE subagent_runs (
    thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
    parent_generation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    binding TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX subagent_runs_by_parent_generation ON subagent_runs(parent_generation_id);
`;
