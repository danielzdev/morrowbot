import { ProviderInfo } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { readyInfo } from './info.ts';
import { judgeVersion } from './version.ts';

const personal = { kind: 'personal', accountKey: 'key', accountLabel: 'Claude Max 5x' } as const;

it('judges the CLI version against the tested range', () => {
  expect(['2.1.331', '2.1.332', '2.1.400', '2.2.0', '3.0.0', 'nightly'].map((version) => judgeVersion(version))).toMatchInlineSnapshot(`
    [
      {
        "kind": "below",
        "version": "2.1.331",
      },
      {
        "kind": "supported",
        "version": "2.1.332",
      },
      {
        "kind": "supported",
        "version": "2.1.400",
      },
      {
        "kind": "above",
        "reason": "Claude 2.2.0 isn't tested with MorrowBot yet. Update MorrowBot, or point \`cliPath\` at a Claude 2.1.x install.",
        "version": "2.2.0",
      },
      {
        "kind": "above",
        "reason": "Claude 3.0.0 isn't tested with MorrowBot yet. Update MorrowBot, or point \`cliPath\` at a Claude 2.1.x install.",
        "version": "3.0.0",
      },
      {
        "kind": "unreadable",
        "reason": "Claude Code reported a version MorrowBot cannot read ("nightly").",
      },
    ]
  `);
});

it('offers the read-only profile only on a tested version with no policy and a personal login', () => {
  const tested = judgeVersion('2.1.332');
  const newer = judgeVersion('2.2.1');
  if (tested.kind !== 'supported' || newer.kind !== 'above') throw new Error('unexpected version judgement');
  expect({
    ready: ProviderInfo.parse(readyInfo(tested, { kind: 'clear' }, personal)),
    newer: ProviderInfo.parse(readyInfo(newer, { kind: 'clear' }, personal)),
  }).toMatchInlineSnapshot(`
    {
      "newer": {
        "accountKey": "key",
        "accountLabel": "Claude Max 5x",
        "capabilities": {
          "approvals": false,
          "profiles": [],
          "sessions": false,
          "usage": "none",
          "withheld": [
            {
              "access": "read-only",
              "reason": "Claude 2.2.1 isn't tested with MorrowBot yet. Update MorrowBot, or point \`cliPath\` at a Claude 2.1.x install.",
              "vendorSettings": "isolated",
            },
          ],
        },
        "kind": "ready",
        "models": [
          {
            "id": "fable",
            "isDefault": false,
            "label": "Fable",
            "options": [],
          },
          {
            "id": "opus",
            "isDefault": false,
            "label": "Opus",
            "options": [],
          },
          {
            "id": "sonnet",
            "isDefault": false,
            "label": "Sonnet",
            "options": [],
          },
          {
            "id": "haiku",
            "isDefault": false,
            "label": "Haiku",
            "options": [],
          },
        ],
        "version": "2.2.1",
        "warning": "untested CLI version",
      },
      "ready": {
        "accountKey": "key",
        "accountLabel": "Claude Max 5x",
        "capabilities": {
          "approvals": false,
          "profiles": [
            {
              "access": "read-only",
              "modes": [
                "interactive",
                "background",
              ],
              "readsOutsideCwd": false,
              "vendorSettings": "isolated",
            },
          ],
          "sessions": false,
          "usage": "none",
          "withheld": [],
        },
        "kind": "ready",
        "models": [
          {
            "id": "fable",
            "isDefault": false,
            "label": "Fable",
            "options": [],
          },
          {
            "id": "opus",
            "isDefault": false,
            "label": "Opus",
            "options": [],
          },
          {
            "id": "sonnet",
            "isDefault": false,
            "label": "Sonnet",
            "options": [],
          },
          {
            "id": "haiku",
            "isDefault": false,
            "label": "Haiku",
            "options": [],
          },
        ],
        "version": "2.1.332",
        "warning": null,
      },
    }
  `);
});

it('withholds the profile with every reason, and shows no account when policy kept auth status from running', () => {
  const tested = judgeVersion('2.1.332');
  if (tested.kind !== 'supported') throw new Error('unexpected version judgement');
  const team = { kind: 'withheld', accountKey: 'team-key', reason: 'Team plans are not supported.' } as const;
  const info = (policy: Parameters<typeof readyInfo>[1], auth: Parameters<typeof readyInfo>[2]) => {
    const ready = ProviderInfo.parse(readyInfo(tested, policy, auth));
    return ready.kind === 'ready'
      ? { accountKey: ready.accountKey, accountLabel: ready.accountLabel, profiles: ready.capabilities.profiles, withheld: ready.capabilities.withheld }
      : ready;
  };
  expect({
    team: info({ kind: 'clear' }, team),
    policy: info({ kind: 'withheld', reason: 'Managed settings are installed.' }, null),
  }).toMatchInlineSnapshot(`
    {
      "policy": {
        "accountKey": "",
        "accountLabel": null,
        "profiles": [],
        "withheld": [
          {
            "access": "read-only",
            "reason": "Managed settings are installed.",
            "vendorSettings": "isolated",
          },
        ],
      },
      "team": {
        "accountKey": "team-key",
        "accountLabel": null,
        "profiles": [],
        "withheld": [
          {
            "access": "read-only",
            "reason": "Team plans are not supported.",
            "vendorSettings": "isolated",
          },
        ],
      },
    }
  `);
});
