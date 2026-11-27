import { COLLABORATOR_NOTICE, type AgentMessage, type TurnOutcome } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { messageTime } from '../../shared/format.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { directionOf, readNote, replyNote, summarize } from './agent-exchange.ts';
import { Markdown, type MarkdownActions } from './Markdown.tsx';

/** The agents a chat can show beside agent messages: their names, accent colors and avatars. */
export interface PeerDirectory {
  name(agentId: string): string;
  /** The agent's avatar color, `#rrggbb`. */
  color(agentId: string): string;
  avatar(agentId: string, size: number): ComponentChildren;
}

export function Peer(props: { readonly peers: PeerDirectory; readonly agentId: string }) {
  return (
    <span class="exchange-peer" style={{ '--peer': props.peers.color(props.agentId) }}>
      <span class="exchange-avatar" aria-hidden="true">{props.peers.avatar(props.agentId, 16)}</span>
      {props.peers.name(props.agentId)}
    </span>
  );
}

function ExchangeCard(props: {
  readonly message: AgentMessage;
  readonly threadId: string;
  readonly peers: PeerDirectory;
  readonly actions: MarkdownActions;
  readonly readEnd: TurnOutcome | undefined;
}) {
  const { message, peers } = props;
  const sender = message.from.agentId;
  const incoming = directionOf(message, props.threadId) === 'incoming';
  const note = readNote(props.readEnd);
  return (
    <li class={`exchange-card ${incoming ? 'incoming' : 'outgoing'}`} style={{ '--peer': peers.color(sender) }} data-agent-message-id={message.id}>
      <div class="exchange-from">
        {peers.name(sender)}
        <span class="exchange-to"> to {peers.name(message.to.agentId)}</span>
      </div>
      <div class="exchange-row">
        <span class="exchange-card-avatar" aria-hidden="true">{peers.avatar(sender, 28)}</span>
        <div class="exchange-body">
          <Markdown text={message.text} actions={props.actions} />
          <div class="exchange-meta">
            {replyNote(message)} · {messageTime(message.createdAt, Date.now())}
            {incoming && <span class="exchange-trust" title={COLLABORATOR_NOTICE}> · From an agent, not you</span>}
            {note !== null && <span class="exchange-read-note"> · {note}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Agent messages between two chat messages: one quiet centered line, opened in place to show each message. */
export function AgentExchange(props: {
  readonly messages: readonly AgentMessage[];
  readonly threadId: string;
  readonly peers: PeerDirectory;
  readonly actions: MarkdownActions;
  /** How background turns that read these messages ended early, by message id. */
  readonly readEnds: Readonly<Record<string, TurnOutcome>>;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const summary = summarize(props.messages, props.threadId);
  if (summary === null) return null;
  const time = messageTime(summary.at, Date.now());
  return (
    <div class={`exchange${open ? ' open' : ''}`}>
      <button class="exchange-pill" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => { setOpen(!open); }}>
        {summary.kind === 'single' ? (
          <>
            <span class="exchange-verb">{summary.verb}</span>
            <Peer peers={props.peers} agentId={summary.peerId} />
          </>
        ) : (
          <>
            <span class="exchange-verb">{String(summary.count)} messages with</span>
            {summary.peerIds.length === 1 && summary.peerIds[0] !== undefined ? (
              <Peer peers={props.peers} agentId={summary.peerIds[0]} />
            ) : (
              <span class="exchange-peer">
                <span class="exchange-stack" aria-hidden="true">
                  {summary.peerIds.slice(0, 3).map((id) => <span key={id} class="exchange-avatar">{props.peers.avatar(id, 16)}</span>)}
                </span>
                {String(summary.peerIds.length)} agents
              </span>
            )}
          </>
        )}
        <span class="exchange-time">{time}</span>
        <span class="exchange-chevron" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
      </button>
      {open && (
        <ol id={bodyId} class="exchange-cards">
          {props.messages.map((message) => (
            <ExchangeCard
              key={message.id}
              message={message}
              threadId={props.threadId}
              peers={props.peers}
              actions={props.actions}
              readEnd={props.readEnds[message.id]}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
