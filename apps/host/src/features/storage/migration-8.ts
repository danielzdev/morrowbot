/**
 * Migration 8 (routines). A routine's schedule is one of three shapes, kept whole by the CHECKs; each run
 * keeps its result, and a wait is something an agent waits on outside Ori Kami until a wake call closes it.
 */
export const MIGRATION_8 = `
  CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('cron', 'once', 'manual')),
    cron_expr TEXT,
    timezone TEXT,
    run_at TEXT,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    stay_quiet_if_nothing_new INTEGER NOT NULL CHECK (stay_quiet_if_nothing_new IN (0, 1)),
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((schedule_kind = 'cron') = (cron_expr IS NOT NULL AND timezone IS NOT NULL)),
    CHECK ((schedule_kind = 'once') = (run_at IS NOT NULL))
  ) STRICT;
  CREATE INDEX routines_by_agent ON routines(agent_id);
  CREATE INDEX routines_due ON routines(next_run_at) WHERE next_run_at IS NOT NULL;

  CREATE TABLE waits (
    wait_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    routine_id TEXT REFERENCES routines(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    woken_at TEXT,
    closed_at TEXT,
    CHECK (woken_at IS NULL OR closed_at IS NOT NULL)
  ) STRICT;
  CREATE INDEX waits_open ON waits(opened_at) WHERE closed_at IS NULL;

  CREATE TABLE routine_runs (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual', 'wake')),
    wait_id TEXT REFERENCES waits(wait_id) ON DELETE SET NULL,
    at TEXT NOT NULL,
    thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'posted', 'quiet', 'failed', 'missed')),
    finished_at TEXT,
    reason TEXT,
    CHECK ((status IN ('posted', 'quiet', 'failed')) = (finished_at IS NOT NULL)),
    CHECK ((status = 'failed') = (reason IS NOT NULL))
  ) STRICT;
  CREATE INDEX routine_runs_by_routine ON routine_runs(routine_id, seq);
`;
