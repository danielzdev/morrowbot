import { pendingApprovals, type ActiveTurnView, type ThreadView, type ToolStep } from './thread-model.ts';

/** What a chat is doing: its turn's progress, or a turn that just completed. */
export type ChatActivity = 'idle' | 'queued' | 'thinking' | 'running-tool' | 'streaming' | 'needs-approval' | 'completed';

/** What a queued or running turn is doing right now. */
export type TurnPhase = Exclude<ChatActivity, 'idle' | 'completed'>;

/** How long a chat counts as just completed. */
export const COMPLETED_MS = 4_000;

/** The tool the turn started last of those still running. */
export const runningTool = (turn: ActiveTurnView): ToolStep | undefined =>
  turn.steps.findLast((step): step is ToolStep => step.kind === 'tool' && step.outcome === 'running');

/**
 * An approval waits on the user above all; then a running tool; then the reply: thinking until it has
 * written something, streaming once it has.
 */
export function turnPhase(turn: ActiveTurnView): TurnPhase {
  if (pendingApprovals(turn).length > 0) return 'needs-approval';
  if (turn.state === 'queued') return 'queued';
  if (runningTool(turn) !== undefined) return 'running-tool';
  return turn.text === '' ? 'thinking' : 'streaming';
}

/**
 * The chat's activity after `view`, given what it was and the view before. A turn seen running that ends
 * with a new completed reply makes the chat completed, which lasts until a new turn starts or its time is
 * up. A background turn that ends quietly adds no reply, so the chat just goes idle.
 */
export function nextActivity(before: ChatActivity | undefined, view: ThreadView, previous: ThreadView | null): ChatActivity {
  const now = view.activeTurn === null ? 'idle' : turnPhase(view.activeTurn);
  if (now !== 'idle') return now;
  if (before === 'completed') return 'completed';
  const last = view.messages.at(-1);
  const sawTurn = before !== undefined && before !== 'idle';
  const fresh = last !== undefined && previous?.messages.at(-1)?.id !== last.id;
  return sawTurn && fresh && last.kind === 'assistant' && last.outcome.kind === 'completed' ? 'completed' : 'idle';
}
