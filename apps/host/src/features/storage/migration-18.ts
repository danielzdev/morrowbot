/**
 * Migration 18 (per-agent disabled extensions and optimistic-concurrency revision).
 * - Adds `disabled_extensions` (JSON array of plugin ids turned off for this agent only, default `'[]'`)
 *   and `revision` (monotonically incremented integer, default `0`) to `agents`.
 */
export const MIGRATION_18 = `
  ALTER TABLE agents ADD COLUMN disabled_extensions TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE agents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
`;
