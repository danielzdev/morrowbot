import type { QueuedMessage, QueuedMessageState } from '@morrowbot/contracts';
import type { ThreadScreen, ThreadSession } from './thread-session.ts';
import type { ThreadView } from './thread-model.ts';

function statusOf(state: QueuedMessageState, agent: string): string {
  switch (state.kind) {
    case 'queued':
      return `Queued · ${agent} hasn't seen it yet`;
    case 'steering':
      return state.via === 'native' ? `Steering · on its way to ${agent}` : 'Steering · stopping the reply to send it';
    case 'held':
      return state.reason;
  }
}

/**
 * Messages sent while a reply runs, above the message box, oldest first. Each one says whether the
 * agent has seen it, and offers Steer now (into the running reply) or Send now (when nothing runs),
 * Edit (back into the message box) and Cancel until it is on its way.
 */
export function QueueList(props: { readonly session: ThreadSession; readonly view: ThreadView; readonly screen: ThreadScreen; readonly agentName: string }) {
  const { session, view, screen } = props;
  if (view.queue.length === 0) return null;
  const turn = view.activeTurn;
  const steering = view.queue.some((item) => item.state.kind === 'steering');
  const offline = screen.connection !== 'live';
  const actions = (item: QueuedMessage) => {
    if (item.state.kind === 'steering') return null;
    const acting = offline || screen.queueActing.includes(item.id);
    const now = turn === null ? 'Send now' : 'Steer now';
    const nowDisabled = acting || steering || screen.busy === 'stopping' || (turn !== null && turn.state !== 'running');
    return (
      <div class="queued-actions">
        <button class={item.state.kind === 'queued' ? 'primary' : 'secondary'} disabled={nowDisabled} title={turn === null ? 'Send it as the next message' : `Interrupt ${props.agentName} with it now`} onClick={() => void session.steer(item.id)}>
          {now}
        </button>
        <button class="ghost" disabled={acting} title="Move it back to the message box" onClick={() => void session.editQueued(item.id)}>
          Edit
        </button>
        <button class="ghost" disabled={acting} onClick={() => void session.cancelQueued(item.id)}>
          Cancel
        </button>
      </div>
    );
  };
  return (
    <ul class="queue" aria-label="Queued messages">
      {view.queue.map((item) => (
        <li key={item.id} class={`queued ${item.state.kind}`}>
          <div class="queued-body">
            <span class="queued-status">{statusOf(item.state, props.agentName)}</span>
            <span class="queued-text">{item.text}</span>
          </div>
          {actions(item)}
        </li>
      ))}
    </ul>
  );
}
