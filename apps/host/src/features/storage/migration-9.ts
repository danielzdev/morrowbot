/**
 * Migration 9 (T3 Code watches). A watch follows one T3 thread; `memory` is the watch's own state-machine JSON.
 * Each transition worth telling is one `t3_watch_events` row, unique per (watch, thread, run, kind, fingerprint)
 * so it is never queued twice, and sits in `t3_outbox` until acknowledged. `t3_watch_cursors` keeps how far
 * the host has read each shared file in the watch folder.
 */
export const MIGRATION_9 = `
  CREATE TABLE t3_watches (
    seq INTEGER PRIMARY KEY,
    watch_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('registered', 'discovered')),
    label TEXT,
    registered_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('watching', 'running', 'needs_you', 'stalled', 'finished', 'failed',
      'watch_missing', 'idle_unverified', 'superseded')),
    reason TEXT,
    run_id TEXT,
    memory TEXT NOT NULL,
    settled_at TEXT,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX t3_watches_by_thread ON t3_watches(thread_id, seq);
  CREATE INDEX t3_watches_open ON t3_watches(seq)
    WHERE state IN ('watching', 'running', 'needs_you', 'stalled');

  CREATE TABLE t3_watch_events (
    seq INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    watch_id TEXT REFERENCES t3_watches(watch_id) ON DELETE CASCADE,
    thread_id TEXT,
    run_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('needs_you', 'failed', 'stalled', 'watch_missing', 'idle_unverified', 'finished',
      't3_unreachable', 't3_degraded')),
    fingerprint TEXT NOT NULL,
    reason TEXT,
    at TEXT NOT NULL,
    CHECK ((watch_id IS NULL) = (kind IN ('t3_unreachable', 't3_degraded'))),
    CHECK ((watch_id IS NULL) = (thread_id IS NULL))
  ) STRICT;
  CREATE UNIQUE INDEX t3_watch_events_once
    ON t3_watch_events(ifnull(watch_id, ''), ifnull(thread_id, ''), ifnull(run_id, ''), kind, fingerprint);

  CREATE TABLE t3_outbox (
    event_id TEXT PRIMARY KEY REFERENCES t3_watch_events(event_id) ON DELETE CASCADE,
    queued_at TEXT NOT NULL,
    dispatched_at TEXT
  ) STRICT;

  CREATE TABLE t3_watch_cursors (
    name TEXT PRIMARY KEY,
    inode TEXT NOT NULL,
    byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0)
  ) STRICT;
`;
