import type { ActiveTurnView, ThreadView } from './thread-model.ts';

/** What a chat is doing: its turn's progress, or a turn that just completed. */
export type ChatActivity = 'idle' | 'queued' | 'thinking' | 'streaming' | 'needs-approval' | 'completed';

/** How long a chat counts as just completed. */
export const COMPLETED_MS = 4_000;

function turnActivity(turn: ActiveTurnView | null): ChatActivity {
  if (turn === null) return 'idle';
  if (turn.approvals.length > 0) return 'needs-approval';
  if (turn.state === 'queued') return 'queued';
  return turn.text === '' && turn.tools.length === 0 ? 'thinking' : 'streaming';
}

/**
 * The chat's activity after `view`, given what it was. A turn seen running that ends with a
 * completed reply makes the chat completed, which lasts until a new turn starts or its time is up.
 */
export function nextActivity(before: ChatActivity | undefined, view: ThreadView): ChatActivity {
  const now = turnActivity(view.activeTurn);
  if (now !== 'idle') return now;
  if (before === 'completed') return 'completed';
  const last = view.messages.at(-1);
  const sawTurn = before !== undefined && before !== 'idle';
  return sawTurn && last?.kind === 'assistant' && last.outcome.kind === 'completed' ? 'completed' : 'idle';
}
