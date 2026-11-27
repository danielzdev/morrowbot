import { ProviderInfo } from '@morrowbot/contracts';
import { readOptionalFile, z } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { MODELS, readyInfo } from './info.ts';
import { judgeVersion } from './version.ts';

const personal = { kind: 'personal', accountKey: 'key', accountLabel: 'Claude Max 5x' } as const;

/** The models are checked on their own below. */
const modelIds = (info: ProviderInfo) => (info.kind === 'ready' ? { ...info, models: info.models.map((model) => model.id) } : info);

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

it('offers both profiles, with approvals and live usage, only on a tested version with no policy and a personal login', () => {
  const tested = judgeVersion('2.1.332');
  const newer = judgeVersion('2.2.1');
  if (tested.kind !== 'supported' || newer.kind !== 'above') throw new Error('unexpected version judgement');
  expect({
    ready: modelIds(ProviderInfo.parse(readyInfo(tested, { kind: 'clear' }, personal, 'darwin'))),
    newer: modelIds(ProviderInfo.parse(readyInfo(newer, { kind: 'clear' }, personal, 'darwin'))),
  }).toMatchInlineSnapshot(`
    {
      "newer": {
        "accountKey": "key",
        "accountLabel": "Claude Max 5x",
        "capabilities": {
          "approvals": false,
          "profiles": [],
          "sessions": false,
          "usage": "live",
          "withheld": [
            {
              "access": "read-only",
              "reason": "Claude 2.2.1 isn't tested with MorrowBot yet. Update MorrowBot, or point \`cliPath\` at a Claude 2.1.x install.",
              "vendorSettings": "isolated",
            },
            {
              "access": "workspace-write",
              "reason": "Claude 2.2.1 isn't tested with MorrowBot yet. Update MorrowBot, or point \`cliPath\` at a Claude 2.1.x install.",
              "vendorSettings": "isolated",
            },
          ],
        },
        "kind": "ready",
        "models": [
          "fable",
          "opus",
          "sonnet",
          "haiku",
        ],
        "version": "2.2.1",
        "warning": "untested CLI version",
      },
      "ready": {
        "accountKey": "key",
        "accountLabel": "Claude Max 5x",
        "capabilities": {
          "approvals": true,
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
            {
              "access": "workspace-write",
              "modes": [
                "interactive",
                "background",
              ],
              "readsOutsideCwd": false,
              "vendorSettings": "isolated",
            },
          ],
          "sessions": false,
          "usage": "live",
          "withheld": [],
        },
        "kind": "ready",
        "models": [
          "fable",
          "opus",
          "sonnet",
          "haiku",
        ],
        "version": "2.1.332",
        "warning": null,
      },
    }
  `);
});

it('withholds each profile with every reason, and shows no account when policy kept auth status from running', () => {
  const tested = judgeVersion('2.1.332');
  if (tested.kind !== 'supported') throw new Error('unexpected version judgement');
  const team = { kind: 'withheld', accountKey: 'team-key', reason: 'Team plans are not supported.' } as const;
  const info = (policy: Parameters<typeof readyInfo>[1], auth: Parameters<typeof readyInfo>[2]) => {
    const ready = ProviderInfo.parse(readyInfo(tested, policy, auth, 'darwin'));
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
          {
            "access": "workspace-write",
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
          {
            "access": "workspace-write",
            "reason": "Team plans are not supported.",
            "vendorSettings": "isolated",
          },
        ],
      },
    }
  `);
});

it('offers only read-only on Linux, where workspace-write has not been checked', () => {
  const tested = judgeVersion('2.1.332');
  if (tested.kind !== 'supported') throw new Error('unexpected version judgement');
  const linux = ProviderInfo.parse(readyInfo(tested, { kind: 'clear' }, personal, 'linux'));
  expect(linux.kind === 'ready' ? linux.capabilities : linux).toMatchInlineSnapshot(`
    {
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
      "usage": "live",
      "withheld": [
        {
          "access": "workspace-write",
          "reason": "Workspace-write for Claude has been checked only on macOS so far, not on linux.",
          "vendorSettings": "isolated",
        },
      ],
    }
  `);
});

it('offers each alias the efforts Claude Code 2.1.332 reports for it, high by default', async () => {
  const recorded = z
    .object({ models: z.array(z.object({ value: z.string(), supportedEffortLevels: z.array(z.string()).optional() })) })
    .parse(JSON.parse((await readOptionalFile(decodeURIComponent(new URL('./fixtures/2.1.332/initialize-models.json', import.meta.url).pathname), { maxBytes: 100_000 })) ?? 'null'));
  const offered = MODELS.map(({ id, options }) => ({ id, options: options.map((option) => ({ ...option, choices: option.choices.map((choice) => choice.id) })) }));
  expect({
    matchesRecording: offered.every(({ id, options }) => JSON.stringify(options[0]?.choices) === JSON.stringify(recorded.models.find((model) => model.value === id)?.supportedEffortLevels)),
    offered,
  }).toMatchInlineSnapshot(`
    {
      "matchesRecording": true,
      "offered": [
        {
          "id": "fable",
          "options": [
            {
              "choices": [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              "defaultChoiceId": "high",
              "id": "effort",
              "label": "Effort",
            },
          ],
        },
        {
          "id": "opus",
          "options": [
            {
              "choices": [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              "defaultChoiceId": "high",
              "id": "effort",
              "label": "Effort",
            },
          ],
        },
        {
          "id": "sonnet",
          "options": [
            {
              "choices": [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              "defaultChoiceId": "high",
              "id": "effort",
              "label": "Effort",
            },
          ],
        },
        {
          "id": "haiku",
          "options": [
            {
              "choices": [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              "defaultChoiceId": "high",
              "id": "effort",
              "label": "Effort",
            },
          ],
        },
      ],
    }
  `);
});
