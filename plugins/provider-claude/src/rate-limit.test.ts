import { TurnEnd } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { parseRateLimit } from './rate-limit.ts';
import { createTurnReader } from './reader.ts';

/**
 * Written by hand: the recorded 2.1.332 events (`fixtures/2.1.332/`) are all `allowed`. It is their
 * shape with the five-hour window refusing; no refusal has been recorded yet.
 */
const rejected = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'rejected',
    resetsAt: 1795788600,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 1, resetsAt: 1795788600, status: 'rejected' },
      seven_day: { utilization: 0.4123, resetsAt: 1795845600, status: 'allowed' },
      seven_day_opus: { utilization: 0.9, resetsAt: 1795845600, status: 'allowed' },
    },
  },
  session_id: 's',
};

it('reads every known window from a refusing event, and the window that refused', () => {
  expect(parseRateLimit(rejected)).toMatchInlineSnapshot(`
    {
      "rejected": {
        "resetsAt": "2026-11-27T14:10:00.000Z",
        "windowId": "five_hour",
      },
      "windows": [
        {
          "id": "five_hour",
          "kind": "session",
          "label": "Session",
          "resetsAt": "2026-11-27T14:10:00.000Z",
          "scope": {
            "kind": "account",
          },
          "usedPercent": 100,
          "windowMinutes": 300,
        },
        {
          "id": "seven_day",
          "kind": "weekly",
          "label": "Weekly",
          "resetsAt": "2026-11-28T06:00:00.000Z",
          "scope": {
            "kind": "account",
          },
          "usedPercent": 41.23,
          "windowMinutes": 10080,
        },
      ],
    }
  `);
});

it('is not a refusal while overage covers the turn', () => {
  const overage = { ...rejected, rate_limit_info: { ...rejected.rate_limit_info, overageStatus: 'allowed' } };
  expect(parseRateLimit(overage)?.rejected).toBeNull();
});

it('fails the turn as rate-limited with the reset time when the result reports the refusal', () => {
  const reader = createTurnReader(
    { home: null },
    { emit: () => undefined, usage: () => undefined, control: () => undefined, done: () => undefined },
  );
  reader.read(JSON.stringify(rejected));
  reader.read(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit · resets 2:10pm" }));
  const end = TurnEnd.parse(reader.finish({ kind: 'exited', code: 1, signal: null, stderr: '' }, { cliPath: 'claude', accountKey: 'key', cancelled: false }));
  expect(end.outcome).toMatchInlineSnapshot(`
    {
      "error": {
        "kind": "rate-limited",
        "resetsAt": "2026-11-27T14:10:00.000Z",
        "windowId": "five_hour",
      },
      "kind": "failed",
    }
  `);
});
