import { FinishReason, type TurnOutcome } from '@morrowbot/contracts';
import { expect, test } from 'vitest';
import { describeOutcome } from './outcome.ts';

test('Continue is offered only where the host accepts it: on failed or interrupted replies', () => {
  const outcomes: TurnOutcome[] = [
    ...FinishReason.options.map((finishReason): TurnOutcome => ({ kind: 'completed', finishReason })),
    { kind: 'cancelled' },
    { kind: 'interrupted' },
    { kind: 'failed', error: { kind: 'transient', retryAfterMs: null } },
  ];
  const offers = outcomes.map((outcome) => {
    const note = describeOutcome(outcome);
    const label = outcome.kind === 'completed' ? `completed/${outcome.finishReason}` : outcome.kind;
    return `${label}: ${note.label ?? '-'}${note.continueOffer === null ? '' : ` [${note.continueOffer.label}]`}`;
  });
  expect(offers).toMatchInlineSnapshot(`
    [
      "completed/stop: -",
      "completed/length: The reply hit its length limit.",
      "completed/refused: The model declined to answer.",
      "completed/turn-limit: The reply hit its turn limit.",
      "cancelled: Stopped.",
      "interrupted: Interrupted: MorrowBot stopped before this reply finished. [Continue]",
      "failed: The provider had a temporary problem. [Continue]",
    ]
  `);
});
