import { readOptionalFile } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { GetAccountRateLimitsResponse } from './protocol.ts';
import { windowsOf } from './usage.ts';

/** A real `account/rateLimits/read` answer from Codex 0.171 on a ChatGPT Pro plan. */
const REAL = GetAccountRateLimitsResponse.parse(
  JSON.parse((await readOptionalFile(decodeURIComponent(new URL('./fixtures/0.171.0/rate-limits.json', import.meta.url).pathname), { maxBytes: 100_000 })) ?? 'null'),
);

const snapshot = (fields: Readonly<Record<string, unknown>>): GetAccountRateLimitsResponse =>
  GetAccountRateLimitsResponse.parse({ rateLimits: { limitId: 'codex', planType: 'plus', primary: null, secondary: null, ...fields }, rateLimitsByLimitId: null, accountId: null });

it('reads the real Pro answer as one weekly window', () => {
  expect(windowsOf(REAL)).toMatchInlineSnapshot(`
    [
      {
        "id": "primary",
        "kind": "weekly",
        "label": "Weekly",
        "resetsAt": "2026-11-29T20:30:57.000Z",
        "scope": {
          "kind": "account",
        },
        "usedPercent": 5,
        "windowMinutes": 10080,
      },
    ]
  `);
});

it('names windows by their length, falls back by position and plan, and leaves out other limits', () => {
  expect({
    sessionAndWeek: windowsOf(snapshot({ primary: { usedPercent: 12.5, windowDurationMins: 300, resetsAt: 1795000000 }, secondary: { usedPercent: 140, windowDurationMins: 10080, resetsAt: null } })),
    noDurations: windowsOf(snapshot({ primary: { usedPercent: 1 }, secondary: { usedPercent: 2 } })),
    freePlanMonth: windowsOf(snapshot({ planType: 'free', primary: { usedPercent: 3 } })),
    creditLimit: windowsOf(snapshot({ individualLimit: { remainingPercent: 70, resetsAt: 1795000000 } })),
    modelLimit: windowsOf(snapshot({ limitId: 'gpt-other', primary: { usedPercent: 50, windowDurationMins: 300 } })),
  }).toMatchInlineSnapshot(`
    {
      "creditLimit": [
        {
          "id": "individual",
          "kind": "monthly",
          "label": "Monthly credit limit",
          "resetsAt": "2026-11-18T11:06:40.000Z",
          "scope": {
            "kind": "account",
          },
          "usedPercent": 30,
          "windowMinutes": null,
        },
      ],
      "freePlanMonth": [
        {
          "id": "primary",
          "kind": "monthly",
          "label": "Monthly",
          "resetsAt": null,
          "scope": {
            "kind": "account",
          },
          "usedPercent": 3,
          "windowMinutes": 43200,
        },
      ],
      "modelLimit": [],
      "noDurations": [
        {
          "id": "primary",
          "kind": "session",
          "label": "Session",
          "resetsAt": null,
          "scope": {
            "kind": "account",
          },
          "usedPercent": 1,
          "windowMinutes": 300,
        },
        {
          "id": "secondary",
          "kind": "weekly",
          "label": "Weekly",
          "resetsAt": null,
          "scope": {
            "kind": "account",
          },
          "usedPercent": 2,
          "windowMinutes": 10080,
        },
      ],
      "sessionAndWeek": [
        {
          "id": "primary",
          "kind": "session",
          "label": "Session",
          "resetsAt": "2026-11-18T11:06:40.000Z",
          "scope": {
            "kind": "account",
          },
          "usedPercent": 12.5,
          "windowMinutes": 300,
        },
        {
          "id": "secondary",
          "kind": "weekly",
          "label": "Weekly",
          "resetsAt": null,
          "scope": {
            "kind": "account",
          },
          "usedPercent": 100,
          "windowMinutes": 10080,
        },
      ],
    }
  `);
});
