import { bannerCopy, outcomeCopy, PROVIDER_REFUSED, sessionChoiceCopy, type CopyContext } from './outcome-copy.ts';
import { pendingApprovals, type ThreadView } from './thread-model.ts';
import type { ComposerProblem } from './thread-session.ts';

/** Settings › Chat: announce only status, or status and the text of completed replies. */
export type AnnounceMode = 'status' | 'replies';

/** How much of a reply "Status and replies" reads out. */
const MAX_REPLY_CHARS = 600;

/**
 * What the polite live region says after the view changes (spec §4.1): a turn starting, an
 * approval request, a finished reply or an error. Never streamed text, and nothing on first load.
 * A background turn stays quiet unless it needs an approval.
 */
export function viewAnnouncement(before: ThreadView | null, after: ThreadView, agent: string, context: CopyContext, mode: AnnounceMode): string | null {
  if (before === null) return null;
  const seen = before.messages === after.messages ? null : new Set(before.messages.map(({ id }) => id));
  const reply = seen === null ? undefined : after.messages.findLast((message) => message.kind === 'assistant' && !seen.has(message.id));
  if (reply?.kind === 'assistant') {
    const { outcome } = reply;
    if (outcome.kind === 'completed' && outcome.finishReason === 'stop') {
      return mode === 'replies' && reply.text !== '' ? `${agent} replied: ${reply.text.slice(0, MAX_REPLY_CHARS)}` : `${agent} replied.`;
    }
    const copy = outcomeCopy(outcome, context);
    if (outcome.kind === 'cancelled') return `${agent} stopped.`;
    return outcome.kind === 'completed' ? `${agent} replied. ${copy.text ?? ''}`.trim() : `${agent}'s reply failed. ${copy.text ?? ''}`.trim();
  }
  const turn = after.activeTurn;
  if (turn === null) return null;
  const pendingBefore = new Set(before.activeTurn === null ? [] : pendingApprovals(before.activeTurn).map(({ approvalId }) => approvalId));
  if (pendingApprovals(turn).some(({ approvalId }) => !pendingBefore.has(approvalId))) return `${agent} needs approval.`;
  if (turn.trigger.kind === 'agent-message') return null;
  if (before.activeTurn?.generationId !== turn.generationId) return turn.state === 'queued' ? `${agent} is queued.` : `${agent} is working.`;
  return null;
}

/** What a composer banner says, for the live region and the banner itself. */
export function problemText(problem: ComposerProblem, safe: (text: string) => string | null): string {
  switch (problem.kind) {
    case 'session-choice':
      return sessionChoiceCopy(problem.reason).prompt;
    case 'retry':
      return bannerCopy(problem.reason).text;
    case 'error':
      return (problem.message === '' ? null : safe(problem.message)) ?? PROVIDER_REFUSED;
  }
}
