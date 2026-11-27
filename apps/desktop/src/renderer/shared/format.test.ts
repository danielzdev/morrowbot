import { expect, it } from 'vitest';
import { relativeTime } from './format.ts';

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
