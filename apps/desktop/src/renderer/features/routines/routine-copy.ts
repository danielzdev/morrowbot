import { CronExpr, TimeZone, type Routine, type RoutineRun, type RoutineSchedule } from '@morrowbot/contracts';

/** What the routine form holds while it is being edited. `runAt` is a `datetime-local` value in the user's zone. */
export interface RoutineDraft {
  readonly title: string;
  readonly instruction: string;
  readonly kind: RoutineSchedule['kind'];
  readonly expr: string;
  readonly timezone: string;
  readonly runAt: string;
  readonly stayQuiet: boolean;
}

export function emptyDraft(timezone: string): RoutineDraft {
  return { title: '', instruction: '', kind: 'cron', expr: '0 9 * * 1-5', timezone, runAt: '', stayQuiet: false };
}

/** A `datetime-local` value for `iso`, in the user's own zone. */
export function localInput(iso: string): string {
  const at = new Date(iso);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
}

export function draftOf(routine: Routine, timezone: string): RoutineDraft {
  const { schedule } = routine;
  return {
    title: routine.title,
    instruction: routine.instruction,
    kind: schedule.kind,
    expr: schedule.kind === 'cron' ? schedule.expr : '0 9 * * 1-5',
    timezone: schedule.kind === 'cron' ? schedule.timezone : timezone,
    runAt: schedule.kind === 'once' ? localInput(schedule.runAt) : '',
    stayQuiet: routine.stayQuietIfNothingNew,
  };
}

/** The schedule the draft describes, or why it cannot be saved yet. */
export function scheduleOf(draft: RoutineDraft): { readonly kind: 'ok'; readonly schedule: RoutineSchedule } | { readonly kind: 'invalid'; readonly reason: string } {
  switch (draft.kind) {
    case 'cron': {
      const expr = CronExpr.safeParse(draft.expr);
      if (!expr.success) return { kind: 'invalid', reason: expr.error.issues[0]?.message ?? 'Check the cron pattern.' };
      const timezone = TimeZone.safeParse(draft.timezone.trim());
      if (!timezone.success) return { kind: 'invalid', reason: 'Use a time zone such as Europe/Stockholm or UTC.' };
      return { kind: 'ok', schedule: { kind: 'cron', expr: expr.data, timezone: timezone.data } };
    }
    case 'once': {
      const at = Date.parse(draft.runAt);
      if (draft.runAt === '' || Number.isNaN(at)) return { kind: 'invalid', reason: 'Pick a date and time.' };
      return { kind: 'ok', schedule: { kind: 'once', runAt: new Date(at).toISOString() } };
    }
    case 'manual':
      return { kind: 'ok', schedule: { kind: 'manual' } };
  }
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Common cron patterns in words, such as "Weekdays at 09:00"; anything else is shown as written. */
function cronWords(expr: string): string {
  if (expr === '@hourly' || expr === '0 * * * *') return 'Every hour';
  const fields = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(expr);
  if (fields === null) return expr === '@daily' ? 'Every day at 00:00' : `Cron ${expr}`;
  const [, minute = '0', hour = '0', days = '*'] = fields;
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (days === '*') return `Every day at ${time}`;
  if (days === '1-5') return `Weekdays at ${time}`;
  return `${DAYS[Number(days)] ?? 'Day'}s at ${time}`;
}

/** The schedule in a few words. `format` writes a time the way the app does. */
export function describeSchedule(schedule: RoutineSchedule, format: (iso: string) => string): string {
  switch (schedule.kind) {
    case 'cron':
      return `${cronWords(schedule.expr)} · ${schedule.timezone}`;
    case 'once':
      return `Once, ${format(schedule.runAt)}`;
    case 'manual':
      return 'Only when run by hand or woken';
  }
}

export type RunTone = 'ok' | 'muted' | 'danger' | 'warn' | 'accent';

/** The last run's status line, and the colour of its dot. */
export function lastRunLabel(run: RoutineRun | null, format: (iso: string) => string): { readonly tone: RunTone; readonly text: string } {
  if (run === null) return { tone: 'muted', text: 'Not run yet' };
  const { result } = run;
  switch (result.kind) {
    case 'running':
      return { tone: 'accent', text: 'Running…' };
    case 'posted':
      return { tone: 'ok', text: `Posted a reply · ${format(result.finishedAt)}` };
    case 'quiet':
      return { tone: 'muted', text: `Nothing new · ${format(result.finishedAt)}` };
    case 'failed':
      return { tone: 'danger', text: `Failed · ${format(result.finishedAt)}: ${result.reason}` };
    case 'missed':
      return { tone: 'warn', text: `Missed while MorrowBot was off · ${format(run.at)}` };
  }
}
