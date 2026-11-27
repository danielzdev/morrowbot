/**
 * Migration 4 (sidebar folders). Append-only: never edit a migration that has shipped.
 * Deleting a folder leaves its agents in place, outside any folder.
 */
export const MIGRATION_4 = `
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  ALTER TABLE agents ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
  CREATE INDEX agents_by_folder ON agents(folder_id);
`;
