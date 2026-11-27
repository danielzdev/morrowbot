import type { DatabaseSync } from 'node:sqlite';
import { Routine, RoutineSchedule } from '@morrowbot/contracts';
import { z } from 'zod';

/** A routine as stored: everything but its last run, which `RoutineRunRepository` keeps. */
export type RoutineRecord = Omit<Routine, 'lastRun'>;

const RoutineRecordSchema = Routine.omit({ lastRun: true });

const RoutineRow = z
  .object({
    id: z.string(),
    agent_id: z.string(),
    title: z.string(),
    instruction: z.string(),
    schedule_kind: z.string(),
    cron_expr: z.string().nullable(),
    timezone: z.string().nullable(),
    run_at: z.string().nullable(),
    active: z.number(),
    stay_quiet_if_nothing_new: z.number(),
    last_run_at: z.string().nullable(),
    next_run_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    instruction: row.instruction,
    schedule: RoutineSchedule.parse(
      row.schedule_kind === 'cron'
        ? { kind: 'cron', expr: row.cron_expr, timezone: row.timezone }
        : row.schedule_kind === 'once'
          ? { kind: 'once', runAt: row.run_at }
          : { kind: row.schedule_kind },
    ),
    active: row.active === 1,
    stayQuietIfNothingNew: row.stay_quiet_if_nothing_new === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .pipe(RoutineRecordSchema);

export interface RoutineRepository {
  insert(routine: RoutineRecord): void;
  /** Replaces every column but `id`, `agentId` and `createdAt`. False when no such routine exists. */
  update(routine: RoutineRecord): boolean;
  delete(id: string): boolean;
  get(id: string): RoutineRecord | undefined;
  /** Every routine, or one agent's, oldest first. */
  list(agentId?: string): RoutineRecord[];
  /** Routines whose next run is at or before `at`. */
  due(at: string): RoutineRecord[];
}

function columns(routine: RoutineRecord) {
  const { schedule } = routine;
  return {
    id: routine.id,
    title: routine.title,
    instruction: routine.instruction,
    scheduleKind: schedule.kind,
    cronExpr: schedule.kind === 'cron' ? schedule.expr : null,
    timezone: schedule.kind === 'cron' ? schedule.timezone : null,
    runAt: schedule.kind === 'once' ? schedule.runAt : null,
    active: routine.active ? 1 : 0,
    stayQuiet: routine.stayQuietIfNothingNew ? 1 : 0,
    lastRunAt: routine.lastRunAt,
    nextRunAt: routine.nextRunAt,
    updatedAt: routine.updatedAt,
  };
}

export function routineRepository(db: DatabaseSync): RoutineRepository {
  const insert = db.prepare(
    `INSERT INTO routines (id, agent_id, title, instruction, schedule_kind, cron_expr, timezone, run_at, active,
       stay_quiet_if_nothing_new, last_run_at, next_run_at, created_at, updated_at)
     VALUES (:id, :agentId, :title, :instruction, :scheduleKind, :cronExpr, :timezone, :runAt, :active,
       :stayQuiet, :lastRunAt, :nextRunAt, :createdAt, :updatedAt)`,
  );
  const update = db.prepare(
    `UPDATE routines SET title = :title, instruction = :instruction, schedule_kind = :scheduleKind, cron_expr = :cronExpr,
       timezone = :timezone, run_at = :runAt, active = :active, stay_quiet_if_nothing_new = :stayQuiet,
       last_run_at = :lastRunAt, next_run_at = :nextRunAt, updated_at = :updatedAt
     WHERE id = :id`,
  );
  const remove = db.prepare('DELETE FROM routines WHERE id = ?');
  const get = db.prepare('SELECT * FROM routines WHERE id = ?');
  const listAll = db.prepare('SELECT * FROM routines ORDER BY created_at, rowid');
  const listByAgent = db.prepare('SELECT * FROM routines WHERE agent_id = ? ORDER BY created_at, rowid');
  const due = db.prepare('SELECT * FROM routines WHERE next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, rowid');
  const parse = (row: unknown): RoutineRecord => RoutineRow.parse(row);
  return {
    insert: (routine) => {
      insert.run({ ...columns(routine), agentId: routine.agentId, createdAt: routine.createdAt });
    },
    update: (routine) => update.run(columns(routine)).changes > 0,
    delete: (id) => remove.run(id).changes > 0,
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : parse(row);
    },
    list: (agentId) => (agentId === undefined ? listAll.all() : listByAgent.all(agentId)).map(parse),
    due: (at) => due.all(at).map(parse),
  };
}
