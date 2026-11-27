import { randomUUID } from 'node:crypto';
import type { ApprovalChoice, TurnChunk, TurnMode } from '@morrowbot/contracts';

/** How long an approval waits for the user before it is denied. */
const APPROVAL_EXPIRY_MS = 30 * 60_000;

/** What to show on the approval card. */
export interface ApprovalAsk {
  readonly summary: string;
  readonly choices: readonly ApprovalChoice[];
}

/** The user's choice, or why nobody chose: background turns never ask, and a pending approval ends with its turn or after 30 minutes. */
export type ApprovalAnswer =
  | { readonly kind: 'chosen'; readonly choiceId: string }
  | { readonly kind: 'refused'; readonly reason: 'background' | 'expired' | 'turn-ended' };

/** One turn's approvals. Each reply binds to this turn and one pending approval id. */
export interface TurnApprovals {
  ask(request: ApprovalAsk): Promise<ApprovalAnswer>;
  /** Applies the host's `approval-reply`. Returns false, changing nothing, for an unknown, answered or expired id or a choice it did not offer. */
  reply(approvalId: string, choiceId: string): boolean;
  /** Ends every pending approval as `turn-ended`; later asks are refused the same way. */
  close(): void;
}

interface Pending {
  readonly choices: readonly ApprovalChoice[];
  readonly answer: (answer: ApprovalAnswer) => void;
  readonly timer: NodeJS.Timeout;
}

export function createTurnApprovals(options: {
  readonly mode: TurnMode;
  readonly emit: (chunk: TurnChunk) => void;
  readonly expiryMs?: number;
}): TurnApprovals {
  const pending = new Map<string, Pending>();
  let closed = false;
  const settle = (approvalId: string, answer: ApprovalAnswer): boolean => {
    const entry = pending.get(approvalId);
    if (entry === undefined) return false;
    pending.delete(approvalId);
    clearTimeout(entry.timer);
    entry.answer(answer);
    return true;
  };
  return {
    ask: ({ summary, choices }) => {
      if (options.mode === 'background') return Promise.resolve({ kind: 'refused', reason: 'background' });
      if (closed) return Promise.resolve({ kind: 'refused', reason: 'turn-ended' });
      const approvalId = randomUUID();
      const { promise, resolve } = Promise.withResolvers<ApprovalAnswer>();
      const timer = setTimeout(() => {
        if (settle(approvalId, { kind: 'refused', reason: 'expired' })) options.emit({ kind: 'approval-expired', approvalId });
      }, options.expiryMs ?? APPROVAL_EXPIRY_MS);
      timer.unref();
      pending.set(approvalId, { choices, answer: resolve, timer });
      options.emit({ kind: 'approval-request', approvalId, summary, choices: [...choices] });
      return promise;
    },
    reply: (approvalId, choiceId) => {
      const entry = pending.get(approvalId);
      if (entry?.choices.some((choice) => choice.id === choiceId) !== true) return false;
      return settle(approvalId, { kind: 'chosen', choiceId });
    },
    close: () => {
      closed = true;
      for (const approvalId of [...pending.keys()]) settle(approvalId, { kind: 'refused', reason: 'turn-ended' });
    },
  };
}
