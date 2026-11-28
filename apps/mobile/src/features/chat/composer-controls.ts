import type { QueuedMessage } from '@morrowbot/contracts';
import type { ChatScreen } from './chat-session.ts';

/**
 * The composer's round buttons. `send` is Send while the thread is idle and Queue while a turn runs
 * (the host keeps the message until the reply ends, or until Steer now); while a turn runs it shows
 * only with a draft. `stop` shows only while a turn runs. Nothing is enabled while the chat is stale.
 */
export interface ComposerButtons {
  readonly send: { readonly kind: 'send' | 'queue'; readonly enabled: boolean } | null;
  readonly stop: { readonly enabled: boolean } | null;
}

export function composerButtons(screen: ChatScreen): ComposerButtons {
  if (screen.view.kind !== 'loaded') return { send: { kind: 'send', enabled: false }, stop: null };
  const ready = screen.busy === null && !screen.stale;
  const typed = screen.draft.trim() !== '';
  if (screen.view.value.activeTurn === null && screen.busy !== 'stopping') return { send: { kind: 'send', enabled: ready && typed }, stop: null };
  return { send: typed ? { kind: 'queue', enabled: ready } : null, stop: { enabled: ready } };
}

/**
 * What a queued bubble offers. A message on its way into the reply offers nothing. Otherwise: Steer
 * now (into the running reply) or Send now (nothing runs), plus Edit (back into the message box) and
 * Cancel. Steer now waits while another message is on its way, while the reply is stopping or not
 * yet running, and while another agent's message is being answered. Edit and Cancel wait while a
 * send is on its way, so Edit cannot fold a message into a draft that is being sent.
 */
export type QueuedControls =
  | { readonly kind: 'none' }
  | { readonly kind: 'actions'; readonly now: { readonly label: 'Steer now' | 'Send now'; readonly enabled: boolean }; readonly editable: boolean };

export function queuedControls(screen: ChatScreen, item: QueuedMessage): QueuedControls {
  if (item.state.kind === 'steering' || screen.view.kind !== 'loaded') return { kind: 'none' };
  const { activeTurn, queue } = screen.view.value;
  const acting = screen.stale || screen.queueActing.includes(item.id);
  const steering = queue.some((each) => each.state.kind === 'steering');
  const turnBusy = activeTurn !== null && (activeTurn.state !== 'running' || activeTurn.trigger.kind !== 'chat');
  return {
    kind: 'actions',
    now: { label: activeTurn === null ? 'Send now' : 'Steer now', enabled: !acting && !steering && screen.busy !== 'stopping' && !turnBusy },
    editable: !acting && screen.busy !== 'sending',
  };
}
