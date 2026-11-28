import { useEffect, useRef, useState } from 'react';
import type { AvatarActivity } from '../../lib/bot-avatar/index.ts';
import { pendingApprovals, type ActiveTurnView, type ThreadView, type ToolStep } from './thread-view.ts';

/** What a queued or running turn is doing right now. */
export type TurnPhase = Exclude<AvatarActivity, 'idle' | 'completed'>;

/** How long a chat counts as just completed: the avatar's celebration, then it goes. */
export const COMPLETED_MS = 4_000;

const running = (turn: ActiveTurnView): boolean => turn.steps.some((step): step is ToolStep => step.kind === 'tool' && step.outcome === 'running');

/**
 * An approval waits on the user above all; then a running tool; then the reply: thinking until it has
 * written something, streaming once it has.
 */
export function turnPhase(turn: ActiveTurnView): TurnPhase {
  if (pendingApprovals(turn).length > 0) return 'needs-approval';
  if (turn.state === 'queued') return 'queued';
  if (running(turn)) return 'running-tool';
  return turn.text === '' ? 'thinking' : 'streaming';
}

const LABELS: Readonly<Record<TurnPhase, string>> = {
  queued: 'Queued',
  thinking: 'Thinking',
  'running-tool': 'Using a tool',
  streaming: 'Writing',
  'needs-approval': 'Waiting for your approval',
};

const bare = (text: string): string => text.toLowerCase().replace(/[.…\s]+$/u, '');

/**
 * The words beside the running turn's avatar: its phase, then the queue note or the provider's status line
 * when that says more than the phase ("Thinking" beside every later tool says nothing).
 */
export function turnLine(turn: ActiveTurnView): { readonly label: string; readonly detail: string | null } {
  const label = LABELS[turnPhase(turn)];
  if (turn.state === 'queued') return { label, detail: turn.queueNote ?? 'Waiting for a free slot' };
  const { detail } = turn;
  return { label, detail: detail === null || bare(detail) === bare(label) || bare(detail) === 'thinking' ? null : detail };
}

/**
 * The chat's activity after `view`, given what it was and the view before. A turn seen running that ends
 * with a new completed reply makes the chat completed, which lasts until a new turn starts or its time is
 * up. A background turn that ends quietly adds no reply, so the chat just goes idle.
 */
export function nextActivity(before: AvatarActivity | undefined, view: ThreadView, previous: ThreadView | null): AvatarActivity {
  if (view.activeTurn !== null) return turnPhase(view.activeTurn);
  if (before === 'completed') return 'completed';
  const last = view.messages.at(-1);
  const sawTurn = before !== undefined && before !== 'idle';
  const fresh = last !== undefined && previous?.messages.at(-1)?.id !== last.id;
  return sawTurn && fresh && last.kind === 'assistant' && last.outcome.kind === 'completed' ? 'completed' : 'idle';
}

/** The open chat's activity, following its view while loaded; `completed` turns back to `idle` after COMPLETED_MS. */
export function useChatActivity(view: ThreadView | null): AvatarActivity {
  const [activity, setActivity] = useState<AvatarActivity>(() => (view === null ? 'idle' : nextActivity(undefined, view, null)));
  const previous = useRef<ThreadView | null>(view);
  useEffect(() => {
    const before = previous.current;
    if (view === null || view === before) return;
    previous.current = view;
    setActivity((current) => nextActivity(current, view, before));
  }, [view]);
  useEffect(() => {
    if (activity !== 'completed') return;
    const timer = setTimeout(() => {
      setActivity('idle');
    }, COMPLETED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [activity]);
  return activity;
}
