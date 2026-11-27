import { expect, it } from 'vitest';
import type { UsageWindow } from '@morrowbot/plugin-sdk';
import { createUsageSnapshot } from './usage.ts';

const window = (id: string, usedPercent: number): UsageWindow => ({
  id,
  kind: id === 'five_hour' ? 'session' : 'weekly',
  scope: { kind: 'account' },
  label: id,
  usedPercent,
  resetsAt: null,
  windowMinutes: null,
});

const percents = (read: ReturnType<ReturnType<typeof createUsageSnapshot>['read']>) =>
  read === null ? null : { observedAt: read.observedAt, windows: Object.fromEntries(read.windows.map((entry) => [entry.id, entry.usedPercent])) };

it('merges windows by id, keeps the strictly newer observation of each, dates the set by its oldest, and drops them all for another account', () => {
  const snapshot = createUsageSnapshot();
  snapshot.observe('a', '2026-11-27T10:00:00.000Z', [window('five_hour', 10), window('seven_day', 24)]);
  snapshot.observe('a', '2026-11-27T11:00:00.000Z', [window('five_hour', 30)]);
  snapshot.observe('a', '2026-11-27T09:00:00.000Z', [window('seven_day', 5)]);
  snapshot.observe('a', '2026-11-27T11:00:00.000Z', [window('five_hour', 77)]);
  const merged = percents(snapshot.read('a'));
  snapshot.observe('b', '2026-11-27T12:00:00.000Z', [window('five_hour', 1)]);
  snapshot.observe('', '2026-11-27T13:00:00.000Z', [window('five_hour', 99)]);
  expect({ merged, a: percents(snapshot.read('a')), b: percents(snapshot.read('b')) }).toEqual({
    merged: { observedAt: '2026-11-27T10:00:00.000Z', windows: { five_hour: 30, seven_day: 24 } },
    a: null,
    b: { observedAt: '2026-11-27T12:00:00.000Z', windows: { five_hour: 1 } },
  });
});
