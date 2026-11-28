import type { DatabaseSync } from 'node:sqlite';
import { RoutineRun, type RoutineRunResult } from '@morrowbot/contracts';
import { z } from 'zod';

const RunRow = z
  .object({
    id: z.string(),
    routine_id: z.string(),
    trigger: z.string(),
    wait_id: z.string().nullable(),
    at: z.string(),
    thread_id: z.string().nullable(),
    status: z.string(),
    finished_at: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    routineId: row.routine_id,
    trigger: row.trigger,
    waitId: row.wait_id,
    at: row.at,
    threadId: row.thread_id,
    result:
      row.status === 'failed'
        ? { kind: row.status, finishedAt: row.finished_at, reason: row.reason }
        : row.status === 'posted' || row.status === 'quiet'
          ? { kind: row.status, finishedAt: row.finished_at }
          : { kind: row.status },
  }))
  .pipe(RoutineRun);

export interface RoutineRunRepository {
  insert(run: RoutineRun): void;
  /** Records how a running run ended. False unless the run exists and was still running. */
  finish(id: string, result: Exclude<RoutineRunResult, { kind: 'running' | 'missed' }>, threadId: string | null): boolean;
  /** The newest run of each routine, by routine id. */
  latest(): Map<string, RoutineRun>;
  /** Runs a crash or shutdown left running. */
  running(): RoutineRun[];
}

export function routineRunRepository(db: DatabaseSync): RoutineRunRepository {
  const insert = db.prepare(
    `INSERT INTO routine_runs (id, routine_id, trigger, wait_id, at, thread_id, status, finished_at, reason)
     VALUES (:id, :routineId, :trigger, :waitId, :at, :threadId, :status, :finishedAt, :reason)`,
  );
  const finish = db.prepare(
    `UPDATE routine_runs SET status = :status, finished_at = :finishedAt, reason = :reason, thread_id = :threadId
     WHERE id = :id AND status = 'running'`,
  );
  const latest = db.prepare(
    'SELECT * FROM routine_runs WHERE seq IN (SELECT MAX(seq) FROM routine_runs GROUP BY routine_id)',
  );
  const running = db.prepare("SELECT * FROM routine_runs WHERE status = 'running' ORDER BY seq");
  const parse = (row: unknown): RoutineRun => RunRow.parse(row);
  return {
    insert: (run) => {
      const { result } = run;
      insert.run({
        id: run.id,
        routineId: run.routineId,
        trigger: run.trigger,
        waitId: run.waitId,
        at: run.at,
        threadId: run.threadId,
        status: result.kind,
        finishedAt: result.kind === 'running' || result.kind === 'missed' ? null : result.finishedAt,
        reason: result.kind === 'failed' ? result.reason : null,
      });
    },
    finish: (id, result, threadId) =>
      finish.run({
        id,
        status: result.kind,
        finishedAt: result.finishedAt,
        reason: result.kind === 'failed' ? result.reason : null,
        threadId,
      }).changes > 0,
    latest: () => new Map(latest.all().map((row): [string, RoutineRun] => {
      const run = parse(row);
      return [run.routineId, run];
    })),
    running: () => running.all().map(parse),
  };
}
