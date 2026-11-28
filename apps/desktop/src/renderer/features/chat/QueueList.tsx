import type { Attachment, QueuedMessage, QueuedMessageState } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
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

function QueuedChip(props: { readonly attachment: Attachment; readonly image: (id: string) => Promise<string | null> }) {
  const { attachment, image } = props;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachment.kind !== 'image') return;
    let live = true;
    void image(attachment.id).then((loaded) => {
      if (live) setUrl(loaded);
    });
    return () => {
      live = false;
    };
  }, [attachment.id, attachment.kind, image]);
  return (
    <li class="queued-chip" title={attachment.name}>
      {url !== null ? (
        <img class="queued-chip-thumb" src={url} alt="" />
      ) : (
        <span class="queued-chip-icon" aria-hidden="true">
          <Icon name="file" size={13} />
        </span>
      )}
      <span class="queued-chip-name">{attachment.name}</span>
    </li>
  );
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
    const nowDisabled = acting || steering || screen.busy === 'stopping' || (turn !== null && (turn.state !== 'running' || turn.trigger.kind !== 'chat'));
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
            {item.attachments.length > 0 && (
              <ul class="queued-attachments" aria-label="Attached files">
                {item.attachments.map((attachment) => (
                  <QueuedChip key={attachment.id} attachment={attachment} image={session.image} />
                ))}
              </ul>
            )}
            {item.text.trim() !== '' && <span class="queued-text">{item.text}</span>}
          </div>
          {actions(item)}
        </li>
      ))}
    </ul>
  );
}
