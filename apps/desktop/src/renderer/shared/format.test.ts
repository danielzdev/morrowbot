import { expect, it } from 'vitest';
import { messageTime, relativeTime } from './format.ts';

it('writes compact ages for sidebar rows and chat lists', () => {
  const now = Date.parse('2026-06-15T12:00:00.000Z');
  const ago = (ms: number) => relativeTime(new Date(now - ms).toISOString(), now);
  const minute = 60_000;
  expect([ago(-5 * minute), ago(20_000), ago(5 * minute), ago(59 * minute), ago(3 * 60 * minute), ago(2 * 24 * 60 * minute), ago(20 * 24 * 60 * minute), ago(100 * 24 * 60 * minute), ago(800 * 24 * 60 * minute)]).toEqual([
    'now',
    'now',
    '5m',
    '59m',
    '3h',
    '2d',
    '2w',
    '3mo',
    '2y',
  ]);
});

it('writes a last message time as a clock time today, a date this year, and a date with the year before', () => {
  const zone = { locale: 'en-US', timeZone: 'America/New_York' };
  const now = Date.parse('2026-11-27T16:30:00.000Z');
  expect(['2026-11-27T15:24:00.000Z', '2026-11-27T04:59:00.000Z', '2026-11-26T23:00:00.000Z', '2026-01-02T12:00:00.000Z', '2025-11-26T12:00:00.000Z'].map((iso) => messageTime(iso, now, zone))).toEqual([
    '10:24 AM',
    'Nov 26',
    'Nov 26',
    'Jan 2',
    'Nov 26, 2025',
  ]);
});
