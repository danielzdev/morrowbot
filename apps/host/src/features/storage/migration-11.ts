/**
 * Migration 11 (T3 watch delivery). Each queued event gets its next eligible time, its deferral count and whether
 * it goes out `unverified`. A batch freezes the events it was first sent with; the partial unique index allows
 * only one unacknowledged batch at a time.
 */
export const MIGRATION_11 = `
  ALTER TABLE t3_outbox ADD COLUMN due_at TEXT;
  UPDATE t3_outbox SET due_at = queued_at;
  ALTER TABLE t3_outbox ADD COLUMN deferrals INTEGER NOT NULL DEFAULT 0 CHECK (deferrals >= 0);
  ALTER TABLE t3_outbox ADD COLUMN counted_deferral_at TEXT;
  ALTER TABLE t3_outbox ADD COLUMN unverified INTEGER NOT NULL DEFAULT 0 CHECK (unverified IN (0, 1));

  CREATE TABLE t3_batches (
    seq INTEGER PRIMARY KEY,
    batch_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    resend_at TEXT NOT NULL,
    acked_at TEXT
  ) STRICT;
  CREATE UNIQUE INDEX t3_batches_one_in_flight ON t3_batches(ifnull(acked_at, '')) WHERE acked_at IS NULL;

  CREATE TABLE t3_batch_events (
    batch_id TEXT NOT NULL REFERENCES t3_batches(batch_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES t3_watch_events(event_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    unverified INTEGER NOT NULL CHECK (unverified IN (0, 1)),
    PRIMARY KEY (batch_id, event_id)
  ) STRICT;
`;
