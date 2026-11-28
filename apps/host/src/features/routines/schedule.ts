import type { RoutineSchedule } from '@morrowbot/contracts';
import { Cron } from 'croner';

/** How late a due run may still start; later than this the host was asleep or off, and the run is skipped. */
export const GRACE_MS = 2 * 60_000;
/** How often the scheduler looks for due routines. */
export const TICK_MS = 15_000;

/** The first time after `after` that the schedule fires, or null when it never will. Throws on a bad cron pattern. */
export function nextAfter(schedule: RoutineSchedule, after: number): string | null {
  switch (schedule.kind) {
    case 'cron': {
      const next = new Cron(schedule.expr, { timezone: schedule.timezone, paused: true }).nextRun(new Date(after));
      return next === null ? null : next.toISOString();
    }
    case 'once': {
      const runAt = Date.parse(schedule.runAt);
      return runAt > after ? new Date(runAt).toISOString() : null;
    }
    case 'manual':
      return null;
  }
}

/** Why this schedule cannot be saved at `now`, or undefined when it can. */
export function scheduleProblem(schedule: RoutineSchedule, now: number): string | undefined {
  switch (schedule.kind) {
    case 'cron': {
      let next: string | null;
      try {
        next = nextAfter(schedule, now);
      } catch (error) {
        return `That cron pattern is not valid: ${error instanceof Error ? error.message : String(error)}`;
      }
      return next === null ? 'That cron pattern never comes round.' : undefined;
    }
    case 'once':
      return nextAfter(schedule, now) === null ? 'That time has already passed.' : undefined;
    case 'manual':
      return undefined;
  }
}

/** The stored form of a schedule: one spelling for each time, so stored times compare as text. */
export function normalized(schedule: RoutineSchedule): RoutineSchedule {
  return schedule.kind === 'once' ? { kind: 'once', runAt: new Date(schedule.runAt).toISOString() } : schedule;
}
