import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

/** A stay-quiet routine's agent replies with exactly this when there is nothing new; the host then posts nothing. */
export const QUIET_MARKER = 'NOTHING_NEW';

/** Five cron fields (minute hour day-of-month month day-of-week) or a nickname such as `@daily`. */
export const CronExpr = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .regex(
        /^(@(yearly|annually|monthly|weekly|daily|hourly)|\S+( \S+){4})$/,
        'Use five cron fields (minute hour day month weekday) or @hourly, @daily, @weekly, @monthly or @yearly',
      ),
  );
export type CronExpr = z.infer<typeof CronExpr>;

/** An IANA time zone such as `Europe/Stockholm` or `UTC`. */
export const TimeZone = z
  .string()
  .min(1)
  .refine((zone) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone !== '';
    } catch {
      return false;
    }
  }, 'Unknown time zone');
export type TimeZone = z.infer<typeof TimeZone>;

/** When a routine runs on its own. A `manual` routine runs only from Run now or a wake call. */
export const RoutineSchedule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cron'), expr: CronExpr, timezone: TimeZone }),
  z.strictObject({ kind: z.literal('once'), runAt: Timestamp }),
  z.strictObject({ kind: z.literal('manual') }),
]);
export type RoutineSchedule = z.infer<typeof RoutineSchedule>;

/** What started a run: its schedule, Run now, or a wake call (`POST /api/routines/:id/run` with a payload or wait). */
export const RoutineTrigger = z.enum(['schedule', 'manual', 'wake']);
export type RoutineTrigger = z.infer<typeof RoutineTrigger>;

export const RoutineRunResult = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('running') }),
  /** The agent replied; the reply stays in the run's chat. */
  z.strictObject({ kind: z.literal('posted'), finishedAt: Timestamp }),
  /** The agent said nothing was new, so the run's chat was removed. */
  z.strictObject({ kind: z.literal('quiet'), finishedAt: Timestamp }),
  z.strictObject({ kind: z.literal('failed'), finishedAt: Timestamp, reason: z.string().min(1) }),
  /** The host was asleep or off when the run was due, so it was skipped (later due times too, with no backlog). */
  z.strictObject({ kind: z.literal('missed') }),
]);
export type RoutineRunResult = z.infer<typeof RoutineRunResult>;

export const RoutineRun = z.strictObject({
  id: EntityId,
  routineId: EntityId,
  trigger: RoutineTrigger,
  waitId: EntityId.nullable(),
  /** When the run started, or for a missed run when it was due. */
  at: Timestamp,
  /** The chat the run posted in; null once removed (quiet) or when the run never started a chat. */
  threadId: EntityId.nullable(),
  result: RoutineRunResult,
});
export type RoutineRun = z.infer<typeof RoutineRun>;

const RoutineTitle = z.string().trim().min(1).max(200);
const RoutineInstruction = z.string().trim().min(1).max(100_000);

export const Routine = z.strictObject({
  id: EntityId,
  agentId: EntityId,
  title: RoutineTitle,
  instruction: RoutineInstruction,
  schedule: RoutineSchedule,
  /** A paused routine skips its schedule; Run now and wake calls still run it. */
  active: z.boolean(),
  stayQuietIfNothingNew: z.boolean(),
  lastRunAt: Timestamp.nullable(),
  /** Null when paused, manual, or a one-time routine whose time has passed. */
  nextRunAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastRun: RoutineRun.nullable(),
});
export type Routine = z.infer<typeof Routine>;

export const RoutineList = z.strictObject({ routines: z.array(Routine) });
export type RoutineList = z.infer<typeof RoutineList>;

export const CreateRoutineRequest = z.strictObject({
  agentId: EntityId,
  title: RoutineTitle,
  instruction: RoutineInstruction,
  schedule: RoutineSchedule,
  active: z.boolean().default(true),
  stayQuietIfNothingNew: z.boolean().default(false),
});
export type CreateRoutineRequest = z.infer<typeof CreateRoutineRequest>;

export const UpdateRoutineRequest = z
  .strictObject({
    title: RoutineTitle,
    instruction: RoutineInstruction,
    schedule: RoutineSchedule,
    active: z.boolean(),
    stayQuietIfNothingNew: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');
export type UpdateRoutineRequest = z.infer<typeof UpdateRoutineRequest>;

/**
 * Runs a routine now, paused or not. A local script can pass what it found as `payload`, and the `waitId`
 * of the wait it was started for; that wait is then closed, so a retried call cannot run it twice.
 */
export const RunRoutineRequest = z.strictObject({
  payload: z.json().optional(),
  waitId: EntityId.optional(),
});
export type RunRoutineRequest = z.infer<typeof RunRoutineRequest>;

export const RunRoutineResponse = z.strictObject({ run: RoutineRun });
export type RunRoutineResponse = z.infer<typeof RunRoutineResponse>;

/** Something an agent is waiting on outside Ori Kami, such as a long build; a wake call closes it. */
export const Wait = z.strictObject({
  waitId: EntityId,
  agentId: EntityId,
  routineId: EntityId.nullable(),
  note: z.string().max(2000),
  openedAt: Timestamp,
  wokenAt: Timestamp.nullable(),
  closedAt: Timestamp.nullable(),
});
export type Wait = z.infer<typeof Wait>;

export const OpenWaitRequest = z.strictObject({
  agentId: EntityId,
  routineId: EntityId.nullable().default(null),
  note: z.string().trim().max(2000).default(''),
});
export type OpenWaitRequest = z.infer<typeof OpenWaitRequest>;

/** The waits still open. */
export const WaitList = z.strictObject({ waits: z.array(Wait) });
export type WaitList = z.infer<typeof WaitList>;
