import { useEffect, useState } from 'react';
import type { AvatarActivity } from '../../lib/bot-avatar/index.ts';
import type { ChatScreen } from './chat-session.ts';
import type { Store } from './store.ts';
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

const loadedView = (screen: ChatScreen): ThreadView | null => (screen.view.kind === 'loaded' ? screen.view.value : null);

/**
 * The open chat's activity, following every change to its screen (not only the ones that get drawn, so a turn
 * that starts and finishes between two renders still completes); `completed` turns back to `idle` after COMPLETED_MS.
 */
export function useChatActivity(screen: Store<ChatScreen>): AvatarActivity {
  const [start] = useState(() => loadedView(screen.get()));
  const [activity, setActivity] = useState<AvatarActivity>(() => (start === null ? 'idle' : nextActivity(undefined, start, null)));
  useEffect(() => {
    let previous = start;
    const follow = (value: ChatScreen): void => {
      const view = loadedView(value);
      if (view === previous) return;
      const before = previous;
      previous = view;
      setActivity((current) => (view === null ? 'idle' : nextActivity(current, view, before)));
    };
    follow(screen.get());
    return screen.subscribe(follow);
  }, [screen, start]);
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
