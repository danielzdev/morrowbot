import type { Message, PendingApproval } from '@morrowbot/contracts';
import { useEffect, useRef } from 'preact/hooks';
import { BlockedBanner } from '../../shared/BlockedBanner.tsx';
import { formatTime } from '../../shared/format.ts';
import { useStore } from '../../shared/use-store.ts';
import { describeOutcome } from './outcome.ts';
import type { ActiveTurnView, ToolCall } from './thread-model.ts';
import type { ThreadSession } from './thread-session.ts';

function MessageItem(props: { readonly message: Message; readonly latest: boolean; readonly session: ThreadSession; readonly busy: boolean }) {
  const { message } = props;
  if (message.kind === 'user') {
    return (
      <div class="message user">
        <div class="bubble">{message.text}</div>
      </div>
    );
  }
  const note = describeOutcome(message.outcome);
  const offer = props.latest ? note.continueOffer : null;
  return (
    <div class={`message assistant tone-${note.tone}`}>
      {message.text !== '' && <div class="text">{message.text}</div>}
      {message.seedTruncated === true && <div class="note muted">Older messages were not sent.</div>}
      {note.label !== null && (
        <div class={`note ${note.tone}`}>
          {note.label}
          {note.resetsAt !== null && <span> Resets {formatTime(note.resetsAt)}.</span>}
        </div>
      )}
      {offer !== null && (
        <div class="offer">
          {offer.prompt !== null && <span>{offer.prompt}</span>}
          <button
            class="secondary"
            disabled={props.busy}
            onClick={() => void props.session.continueTurn(message.id, offer.sessionChoice)}
          >
            {offer.label}
          </button>
        </div>
      )}
    </div>
  );
}

function ToolLine({ tool }: { readonly tool: ToolCall }) {
  const icon = tool.outcome === 'running' ? '…' : tool.outcome === 'ok' ? '✓' : '✕';
  return (
    <div class={`tool ${tool.outcome}`}>
      <span class="tool-icon">{icon}</span> {tool.name}
      <code>{JSON.stringify(tool.input)}</code>
    </div>
  );
}

function ApprovalCard(props: { readonly approval: PendingApproval; readonly answering: boolean; readonly session: ThreadSession }) {
  return (
    <div class="card approval" role="alertdialog" aria-label="Approval needed">
      <div class="card-title">Approval needed</div>
      <div class="card-body">{props.approval.summary}</div>
      <div class="card-actions">
        {props.approval.choices.map((choice) => (
          <button
            key={choice.id}
            class={choice.id === 'allow' ? 'primary' : 'secondary'}
            disabled={props.answering}
            onClick={() => void props.session.answer(props.approval.approvalId, choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <div class="card-foot">Unanswered requests are denied after 30 minutes.</div>
    </div>
  );
}

function ActiveTurn(props: { readonly turn: ActiveTurnView; readonly answering: readonly string[]; readonly session: ThreadSession }) {
  const { turn } = props;
  const status = turn.state === 'queued' ? (turn.queueNote ?? 'Queued: waiting for a free slot') : (turn.detail ?? 'Working');
  return (
    <div class="message assistant active">
      <div class={`status ${turn.state}`}>
        <span class="pulse" /> {turn.state === 'queued' ? 'Queued' : 'Running'} · {status}
      </div>
      {turn.tools.map((tool) => (
        <ToolLine key={tool.toolUseId} tool={tool} />
      ))}
      {turn.text !== '' && <div class="text">{turn.text}</div>}
      {turn.approvals.map((approval) => (
        <ApprovalCard
          key={approval.approvalId}
          approval={approval}
          answering={props.answering.includes(approval.approvalId)}
          session={props.session}
        />
      ))}
    </div>
  );
}

/** The chat. `locked` holds Continue back, e.g. while the agent's provider settings save. */
export function ChatView({ session, locked }: { readonly session: ThreadSession; readonly locked: boolean }) {
  const screen = useStore(session.screen);
  const bottom = useRef<HTMLDivElement>(null);
  const view = screen.view.kind === 'loaded' ? screen.view.value : null;
  const tail = view === null ? 0 : view.messages.length + (view.activeTurn?.text.length ?? 0) + (view.activeTurn?.approvals.length ?? 0);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [tail]);
  switch (screen.view.kind) {
    case 'loading':
      return <div class="chat empty">Loading…</div>;
    case 'failed':
      return (
        <div class="chat empty">
          <p>{screen.view.message}</p>
          <button class="secondary" onClick={() => void session.load()}>
            Try again
          </button>
        </div>
      );
    case 'loaded':
      break;
  }
  const loaded = screen.view.value;
  const last = loaded.messages.at(-1);
  const idle = loaded.activeTurn === null && loaded.blockedGroups.length === 0 && screen.busy === null;
  return (
    <div class="chat">
      <BlockedBanner groups={loaded.blockedGroups} onRelease={(regId) => void session.release(regId)} />
      <div class="messages">
        {loaded.messages.length === 0 && loaded.activeTurn === null && <div class="hint">Send a message to start.</div>}
        {loaded.messages.map((message) => (
          <MessageItem key={message.id} message={message} latest={message === last && idle} session={session} busy={!idle || locked} />
        ))}
        {loaded.expiredApprovals.map((summary, index) => (
          <div key={index} class="note warning">
            An approval expired and was denied: {summary}
          </div>
        ))}
        {loaded.activeTurn !== null && <ActiveTurn turn={loaded.activeTurn} answering={screen.answering} session={session} />}
        <div ref={bottom} />
      </div>
    </div>
  );
}
