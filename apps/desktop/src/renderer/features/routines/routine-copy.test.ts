import type { RoutineRun, RoutineSchedule } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { describeSchedule, emptyDraft, lastRunLabel, scheduleOf } from './routine-copy.ts';

const iso = (at: string): string => `<${at}>`;

it('describes schedules in a few words, and common cron patterns in plain language', () => {
  const schedules: RoutineSchedule[] = [
    { kind: 'cron', expr: '0 9 * * 1-5', timezone: 'Europe/Stockholm' },
    { kind: 'cron', expr: '30 7 * * *', timezone: 'UTC' },
    { kind: 'cron', expr: '0 18 * * 5', timezone: 'UTC' },
    { kind: 'cron', expr: '0 * * * *', timezone: 'UTC' },
    { kind: 'cron', expr: '*/15 9-17 * * 1-5', timezone: 'UTC' },
    { kind: 'once', runAt: '2026-03-02T10:00:00.000Z' },
    { kind: 'manual' },
  ];
  expect(schedules.map((schedule) => describeSchedule(schedule, iso))).toMatchInlineSnapshot(`
    [
      "Weekdays at 09:00 · Europe/Stockholm",
      "Every day at 07:30 · UTC",
      "Fridays at 18:00 · UTC",
      "Every hour · UTC",
      "Cron */15 9-17 * * 1-5 · UTC",
      "Once, <2026-03-02T10:00:00.000Z>",
      "Only when run by hand or woken",
    ]
  `);
});

it('names how the last run went', () => {
  const run = (result: RoutineRun['result']): RoutineRun => ({ id: 'r', routineId: 'x', trigger: 'schedule', waitId: null, at: 'due', threadId: null, result });
  const results: RoutineRun['result'][] = [
    { kind: 'running' },
    { kind: 'posted', finishedAt: 'done' },
    { kind: 'quiet', finishedAt: 'done' },
    { kind: 'failed', finishedAt: 'done', reason: 'The provider is signed out.' },
    { kind: 'missed' },
  ];
  expect([lastRunLabel(null, iso), ...results.map((result) => lastRunLabel(run(result), iso))]).toMatchInlineSnapshot(`
    [
      {
        "text": "Not run yet",
        "tone": "muted",
      },
      {
        "text": "Running…",
        "tone": "accent",
      },
      {
        "text": "Posted a reply · <done>",
        "tone": "ok",
      },
      {
        "text": "Nothing new · <done>",
        "tone": "muted",
      },
      {
        "text": "Failed · <done>: The provider is signed out.",
        "tone": "danger",
      },
      {
        "text": "Missed while Ori Kami was off · <due>",
        "tone": "warn",
      },
    ]
  `);
});

it('refuses a draft schedule until it can be saved', () => {
  const draft = emptyDraft('Europe/Stockholm');
  expect([
    scheduleOf(draft),
    scheduleOf({ ...draft, expr: '0 9 * *' }),
    scheduleOf({ ...draft, timezone: 'Mars/Base' }),
    scheduleOf({ ...draft, kind: 'once' }),
    scheduleOf({ ...draft, kind: 'manual' }),
  ]).toMatchInlineSnapshot(`
    [
      {
        "kind": "ok",
        "schedule": {
          "expr": "0 9 * * 1-5",
          "kind": "cron",
          "timezone": "Europe/Stockholm",
        },
      },
      {
        "kind": "invalid",
        "reason": "Use five cron fields (minute hour day month weekday) or @hourly, @daily, @weekly, @monthly or @yearly",
      },
      {
        "kind": "invalid",
        "reason": "Use a time zone such as Europe/Stockholm or UTC.",
      },
      {
        "kind": "invalid",
        "reason": "Pick a date and time.",
      },
      {
        "kind": "ok",
        "schedule": {
          "kind": "manual",
        },
      },
    ]
  `);
});
