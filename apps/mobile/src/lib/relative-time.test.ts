import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time.ts';

describe('relativeTime', () => {
  it('shortens an age to its largest whole unit', () => {
    const now = Date.parse('2026-11-27T12:00:00.000Z');
    const ages = ['2026-11-27T11:59:30.000Z', '2026-11-27T11:27:00.000Z', '2026-11-27T07:00:00.000Z', '2026-11-25T12:00:00.000Z', '2026-11-06T12:00:00.000Z', '2026-07-27T12:00:00.000Z', '2024-11-27T12:00:00.000Z', '2026-11-27T12:05:00.000Z'];
    expect(ages.map((iso) => relativeTime(iso, now))).toMatchInlineSnapshot(`
      [
        "now",
        "33m",
        "5h",
        "2d",
        "3w",
        "4mo",
        "2y",
        "now",
      ]
    `);
  });
});
