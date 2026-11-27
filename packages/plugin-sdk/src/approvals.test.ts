import { TurnChunk } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createTurnApprovals } from './approvals.ts';

const CHOICES = [
  { id: 'allow', label: 'Allow' },
  { id: 'deny', label: 'Deny' },
];

afterEach(() => {
  vi.useRealTimers();
});

/** One turn's approvals, recording each chunk (checked against the contract) and each answer in order. */
function turn(mode: 'interactive' | 'background', expiryMs?: number) {
  const log: unknown[] = [];
  const approvals = createTurnApprovals({
    mode,
    emit: (chunk) => log.push(TurnChunk.parse(chunk)),
    ...(expiryMs === undefined ? {} : { expiryMs }),
  });
  const ask = (summary: string) => approvals.ask({ summary, choices: CHOICES }).then((answer) => log.push({ summary, answer }));
  const idOf = (index: number): string => {
    const chunk = TurnChunk.parse(log.filter((entry) => TurnChunk.safeParse(entry).success)[index]);
    return chunk.kind === 'approval-request' ? chunk.approvalId : '';
  };
  return { approvals, ask, idOf, log };
}

it('emits a card per ask and binds each reply to its approval id, ignoring duplicates, unknown ids and unoffered choices', async () => {
  const { approvals, ask, idOf, log } = turn('interactive');
  const first = ask('Write .git/x');
  const second = ask('Edit .git/config');
  const replies = [
    approvals.reply(idOf(0), 'maybe'),
    approvals.reply('not-an-approval', 'allow'),
    approvals.reply(idOf(1), 'deny'),
    approvals.reply(idOf(0), 'allow'),
    approvals.reply(idOf(0), 'deny'),
  ];
  await Promise.all([first, second]);
  expect({ replies, log: log.map((entry): unknown => JSON.parse(JSON.stringify(entry).replaceAll(/"[0-9a-f-]{36}"/g, '"<id>"'))) })
    .toMatchInlineSnapshot(`
      {
        "log": [
          {
            "approvalId": "<id>",
            "choices": [
              {
                "id": "allow",
                "label": "Allow",
              },
              {
                "id": "deny",
                "label": "Deny",
              },
            ],
            "kind": "approval-request",
            "summary": "Write .git/x",
          },
          {
            "approvalId": "<id>",
            "choices": [
              {
                "id": "allow",
                "label": "Allow",
              },
              {
                "id": "deny",
                "label": "Deny",
              },
            ],
            "kind": "approval-request",
            "summary": "Edit .git/config",
          },
          {
            "answer": {
              "choiceId": "deny",
              "kind": "chosen",
            },
            "summary": "Edit .git/config",
          },
          {
            "answer": {
              "choiceId": "allow",
              "kind": "chosen",
            },
            "summary": "Write .git/x",
          },
        ],
        "replies": [
          false,
          false,
          true,
          true,
          false,
        ],
      }
    `);
});

it('never asks in a background turn', async () => {
  const { ask, log } = turn('background');
  await ask('Write .git/x');
  expect(log).toEqual([{ summary: 'Write .git/x', answer: { kind: 'refused', reason: 'background' } }]);
});

it('expires an unanswered approval after 30 minutes, and then ignores its reply', async () => {
  vi.useFakeTimers();
  const { approvals, ask, idOf, log } = turn('interactive');
  const asked = ask('Write .git/x');
  const id = idOf(0);
  await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
  const pendingBefore = log.length;
  await vi.advanceTimersByTimeAsync(1);
  await asked;
  expect({ pendingBefore, late: approvals.reply(id, 'allow'), after: log.slice(1) }).toEqual({
    pendingBefore: 1,
    late: false,
    after: [
      { kind: 'approval-expired', approvalId: id },
      { summary: 'Write .git/x', answer: { kind: 'refused', reason: 'expired' } },
    ],
  });
});

it('refuses what is pending when the turn ends, and every later ask and reply', async () => {
  const { approvals, ask, idOf, log } = turn('interactive');
  const asked = ask('Write .git/x');
  const id = idOf(0);
  approvals.close();
  await asked;
  await ask('Edit .git/config');
  expect({ late: approvals.reply(id, 'allow'), answers: log.slice(1) }).toEqual({
    late: false,
    answers: [
      { summary: 'Write .git/x', answer: { kind: 'refused', reason: 'turn-ended' } },
      { summary: 'Edit .git/config', answer: { kind: 'refused', reason: 'turn-ended' } },
    ],
  });
});
