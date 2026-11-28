import { FinishReason, ProviderUnavailableReason, SessionChoiceReason, type ProviderError, type TurnOutcome } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { approvalEndingCopy, bannerCopy, outcomeCopy, sessionChoiceCopy, type BannerReason, type CopyContext, type OutcomeCopy } from './outcome-copy.ts';
import type { ApprovalEnding } from './thread-model.ts';

/** One error of every kind; the record type makes a new kind fail to compile until it is listed. */
const ERRORS: { readonly [K in ProviderError['kind']]: Extract<ProviderError, { kind: K }> } = {
  'rate-limited': { kind: 'rate-limited', resetsAt: '2026-11-27T11:10:00.000Z', windowId: 'five_hour' },
  'signed-out': { kind: 'signed-out' },
  'account-changed': { kind: 'account-changed' },
  'not-installed': { kind: 'not-installed' },
  outdated: { kind: 'outdated' },
  'invalid-model': { kind: 'invalid-model' },
  transient: { kind: 'transient', retryAfterMs: null },
  'session-lost': { kind: 'session-lost' },
  'route-changed': { kind: 'route-changed' },
  'context-too-long': { kind: 'context-too-long' },
  'background-not-allowed': { kind: 'background-not-allowed' },
  'access-not-supported': { kind: 'access-not-supported', reason: 'Edits need /Users/sam/.claude to be writable.' },
  'binding-changed': { kind: 'binding-changed' },
  'instructions-changed': { kind: 'instructions-changed' },
  'output-limit': { kind: 'output-limit', limit: 'bytes' },
  other: { kind: 'other', message: 'Claude exited: see /Users/sam/logs for sam@example.com' },
};

const CLAUDE: CopyContext = { provider: 'Claude', safe: (text) => text.replaceAll('/Users/sam', '~').replaceAll('sam@example.com', '<email>') };
const UNSAFE: CopyContext = { provider: null, safe: () => null };

const line = (copy: OutcomeCopy): string =>
  [copy.tone, copy.text ?? '-', copy.resetsAt === null ? null : `resets ${copy.resetsAt}`, copy.action === null ? null : `[${copy.action.label}]`].filter((part) => part !== null).join(' | ');

const outcomes: readonly [string, TurnOutcome][] = [
  ...FinishReason.options.map((finishReason): [string, TurnOutcome] => [`completed/${finishReason}`, { kind: 'completed', finishReason }]),
  ['cancelled', { kind: 'cancelled' }],
  ['interrupted', { kind: 'interrupted' }],
  ...Object.values(ERRORS).map((error): [string, TurnOutcome] => [`failed/${error.kind}`, { kind: 'failed', error }]),
];

it('words every outcome and ProviderError kind, with at most one action', () => {
  expect(Object.fromEntries(outcomes.map(([label, outcome]) => [label, line(outcomeCopy(outcome, CLAUDE))]))).toMatchInlineSnapshot(`
    {
      "cancelled": "muted | Stopped.",
      "completed/length": "warning | The reply hit its length limit.",
      "completed/refused": "warning | The model declined to answer.",
      "completed/stop": "normal | -",
      "completed/turn-limit": "warning | The reply hit its turn limit.",
      "failed/access-not-supported": "error | Edits need ~/.claude to be writable. | [Continue]",
      "failed/account-changed": "error | Claude is now signed in to a different account. | [Open Providers]",
      "failed/background-not-allowed": "error | This provider doesn't run in the background.",
      "failed/binding-changed": "warning | The agent's provider settings changed before this turn ran. Nothing was sent. | [Continue]",
      "failed/context-too-long": "error | This chat is too long for the model. Start a new chat.",
      "failed/instructions-changed": "warning | The agent's instructions changed before this turn ran. Nothing was sent. | [Continue]",
      "failed/invalid-model": "error | Claude doesn't know this model. Pick another one, then Continue. | [Continue]",
      "failed/not-installed": "error | Claude's CLI is not installed. | [Open Providers]",
      "failed/other": "error | Claude exited: see ~/logs for <email> | [Continue]",
      "failed/outdated": "error | Claude's CLI is outdated. | [Open Providers]",
      "failed/output-limit": "warning | The reply hit MorrowBot's output size limit and was cut off.",
      "failed/rate-limited": "warning | Claude's 5-hour limit is reached | resets 2026-11-27T11:10:00.000Z | [Continue]",
      "failed/route-changed": "warning | The provider's endpoint changed. | [Start a new seeded session]",
      "failed/session-lost": "error | Claude lost its saved session. | [Continue]",
      "failed/signed-out": "error | Claude is signed out. | [Open Providers]",
      "failed/transient": "warning | Claude had a temporary problem. | [Continue]",
      "interrupted": "warning | Interrupted: MorrowBot stopped before this reply finished. | [Continue]",
    }
  `);
});

it('never shows host text it cannot make safe, and names no provider it does not know', () => {
  const failed = (error: ProviderError): string => line(outcomeCopy({ kind: 'failed', error }, UNSAFE));
  const overage: ProviderError = { kind: 'rate-limited', resetsAt: null, windowId: 'overage' };
  expect([ERRORS['access-not-supported'], ERRORS.other, ERRORS['signed-out'], overage].map(failed))
    .toMatchInlineSnapshot(`
      [
        "error | The provider can't run with this access level. Pick another one, then Continue. | [Continue]",
        "error | The provider failed. | [Continue]",
        "error | The provider is signed out. | [Open Providers]",
        "warning | The provider's usage limit is reached | [Continue]",
      ]
    `);
});

it('route-changed is an outcome note that continues in a new seeded session, not a session choice', () => {
  expect(outcomeCopy({ kind: 'failed', error: ERRORS['route-changed'] }, CLAUDE).action).toEqual({
    kind: 'continue',
    label: 'Start a new seeded session',
    sessionChoice: { kind: 'new-seeded' },
  });
  expect(SessionChoiceReason.options).not.toContain('route-changed');
});

it('approval expiry is never a turn outcome: only the approval card words it', () => {
  const said = outcomes.map(([, outcome]) => outcomeCopy(outcome, CLAUDE).text ?? '').join('\n');
  expect(said).not.toMatch(/expir|denied automatically/i);
  const endings: ApprovalEnding[] = [{ kind: 'chosen', label: 'Allow' }, { kind: 'chosen', label: 'Deny' }, { kind: 'expired' }, { kind: 'cleared' }, { kind: 'late' }];
  expect(endings.map(approvalEndingCopy)).toMatchInlineSnapshot(`
    [
      "You chose Allow",
      "You chose Deny",
      "Expired: denied automatically",
      "Request ended",
      "This request already ended.",
    ]
  `);
});

it('words every 503 and 409 refusal for the composer banner, and every session choice in v23’s words', () => {
  const reasons: BannerReason[] = [...ProviderUnavailableReason.options, 'binding-changed'];
  const banners = reasons.map((reason) => {
    const copy = bannerCopy(reason);
    return `${reason}: ${copy.text} [${copy.action.label}]`;
  });
  const choices = SessionChoiceReason.options.map((reason) => {
    const copy = sessionChoiceCopy(reason);
    return { reason, prompt: copy.prompt, options: copy.options.map(({ label, warning }) => (warning === null ? label : `${label} (${warning})`)) };
  });
  expect({ banners, choices }).toMatchInlineSnapshot(`
    {
      "banners": [
        "route-info-timeout: Couldn't verify this provider's route or account. [Try again]",
        "route-info-failed: Couldn't verify this provider's route or account. [Try again]",
        "daemon-blocked: An earlier provider process is still running. [Open details]",
        "rechecking: Rechecking the provider… your message is kept. [Try again]",
        "binding-changed: Settings changed while sending. Your message is still here. [Send again]",
      ],
      "choices": [
        {
          "options": [
            "Continue existing (Continuing may repeat actions the provider already took.)",
            "Start a new seeded session",
          ],
          "prompt": "The provider's saved session did not finish its last turn.",
          "reason": "diverged",
        },
        {
          "options": [
            "Start a new seeded session",
          ],
          "prompt": "Instructions changed: start a new seeded session?",
          "reason": "instructions-changed",
        },
        {
          "options": [
            "Start a new seeded session",
          ],
          "prompt": "This chat has messages the provider has not seen: start a new seeded session?",
          "reason": "unseeded-history",
        },
      ],
    }
  `);
});
