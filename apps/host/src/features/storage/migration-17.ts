/**
 * Migration 17 (background read outcomes and unread lookup index).
 * - Adds `read_outcome` (status enum only, never raw provider diagnostics) on `agent_messages` so failed, stopped, or
 *   interrupted background reads survive reloads and host restarts without re-reading the message.
 * - Adds `generations_by_input_message` covering the `NOT EXISTS` unread lookup and `hasInput` checks.
 * - Backfills `read_outcome` for previously settled background reads that recorded `turn_usage`.
 */
export const MIGRATION_17 = `
  ALTER TABLE agent_messages ADD COLUMN read_outcome TEXT
    CHECK (read_outcome IS NULL OR read_outcome IN ('completed', 'cancelled', 'interrupted', 'failed'));
  CREATE INDEX generations_by_input_message ON generations(input_message_id);
  UPDATE agent_messages
  SET read_outcome = (
    SELECT json_extract(u.outcome, '$.kind')
    FROM generations g
    JOIN turn_usage u ON u.generation_id = g.id
    WHERE g.input_message_id = agent_messages.id
      AND g.settled = 1
      AND json_extract(u.outcome, '$.kind') IN ('completed', 'cancelled', 'interrupted', 'failed')
    ORDER BY g.started_at DESC, g.rowid DESC
    LIMIT 1
  )
  WHERE read_outcome IS NULL;
`;
