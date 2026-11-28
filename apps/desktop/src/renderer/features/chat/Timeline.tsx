import type { AgentMessage, Message } from '@morrowbot/contracts';
import { memo } from 'preact/compat';
import { useEffect, useId, useMemo, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import { backgroundVerb } from './agent-exchange.ts';
import { AgentExchange, Peer, type PeerDirectory } from './AgentExchange.tsx';
import { ApprovalCard } from './ApprovalCard.tsx';
import type { ChatDisplay } from './display.ts';
import { ACTIVE_ID } from './find.ts';
import { Markdown, type MarkdownActions } from './Markdown.tsx';
import { outcomeCopy, type CopyContext, type OutcomeAction } from './outcome-copy.ts';
import { OutcomeNote } from './OutcomeNote.tsx';
import { SentAttachments } from './SentAttachments.tsx';
import { SubagentGroup, type EngineLabel } from './SubagentGroup.tsx';
import type { ActiveTurnView, ApprovalStep, FinishedTurn, ThreadView, TurnStep } from './thread-model.ts';
import { TurnSteps } from './ToolGroup.tsx';
import { timelineItems } from './timeline-items.ts';
import { elapsed } from './tool-rows.ts';

/** Everything a message needs that does not change while a reply streams, so history can skip re-rendering. */
export interface TimelineContext {
  readonly display: ChatDisplay;
  readonly copy: CopyContext;
  readonly actions: MarkdownActions;
  readonly onAction: (messageId: string, action: OutcomeAction) => void;
  readonly onAnswer: (approvalId: string, choiceId: string) => void;
  /** A sent image as a data URL; null when it can't be loaded. */
  readonly image: (id: string) => Promise<string | null>;
  readonly peers: PeerDirectory;
  readonly engine: EngineLabel;
}

export const TOOLS_NOT_KEPT = "Tool steps from before this session aren't shown.";

function Since({ startedAt }: { readonly startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1_000);
    return () => { clearInterval(timer); };
  }, []);
  return <>{elapsed(now - startedAt)}</>;
}

function approvalFor(ctx: TimelineContext, answering: readonly string[], offline: boolean) {
  return (step: ApprovalStep) => (
    <ApprovalCard
      step={step}
      answer={answering.includes(step.approval.approvalId) ? 'sending' : offline ? 'held' : 'open'}
      title={ctx.display.safe(step.approval.summary)}
      actions={ctx.actions}
      onAnswer={(choiceId) => { ctx.onAnswer(step.approval.approvalId, choiceId); }}
    />
  );
}

const NO_ANSWERS: readonly string[] = [];

const STEERED_IN = 'Steered in · seen by the agent';

const steered = (message: Message | undefined): boolean => message?.kind === 'assistant' && message.outcome.kind === 'steered';

const MessageItem = memo(function MessageItem(props: {
  readonly message: Message;
  readonly finished: FinishedTurn | undefined;
  readonly latest: boolean;
  readonly busy: boolean;
  /** A user message sent into the reply above it with Steer now. */
  readonly steeredIn: boolean;
  readonly ctx: TimelineContext;
}) {
  const { message, finished, ctx } = props;
  if (message.kind === 'user') {
    return (
      <div class="message user" data-message-id={message.id}>
        {message.attachments.length > 0 && <SentAttachments attachments={message.attachments} image={ctx.image} />}
        {message.text !== '' && <div class="bubble" data-find-id={message.id}>{message.text}</div>}
        {props.steeredIn && <div class="steered-in">{STEERED_IN}</div>}
      </div>
    );
  }
  const copy = outcomeCopy(message.outcome, ctx.copy);
  return (
    <div class={`message assistant tone-${copy.tone}`} data-message-id={message.id}>
      {finished?.durationMs != null && <div class="turn-time">Worked for {elapsed(finished.durationMs)}</div>}
      {finished !== undefined && <TurnSteps steps={finished.steps} display={ctx.display} approval={approvalFor(ctx, NO_ANSWERS, false)} />}
      {message.text !== '' && <div data-find-id={message.id}><Markdown text={message.text} actions={ctx.actions} /></div>}
      <OutcomeNote
        copy={copy}
        seedTruncated={message.seedTruncated === true}
        latest={props.latest}
        busy={props.busy}
        onAction={(action) => { ctx.onAction(message.id, action); }}
      />
    </div>
  );
});

function ActiveTurn(props: { readonly turn: ActiveTurnView; readonly answering: readonly string[]; readonly offline: boolean; readonly ctx: TimelineContext }) {
  const { turn, ctx } = props;
  const detail = turn.state === 'queued' ? (turn.queueNote ?? 'Queued: waiting for a free slot') : turn.detail;
  return (
    <div class="message assistant active">
      <div class={`turn-time ${turn.state}`}>
        <span class="pulse" aria-hidden="true" />
        <Working turn={turn} />
        {detail !== null && <span class="turn-detail"> · {ctx.display.safe(detail) ?? ''}</span>}
      </div>
      <TurnSteps steps={turn.steps} display={ctx.display} approval={approvalFor(ctx, props.answering, props.offline)} />
      {turn.text !== '' && <div data-find-id={ACTIVE_ID}><Markdown text={turn.text} actions={ctx.actions} /></div>}
    </div>
  );
}

function Working({ turn }: { readonly turn: ActiveTurnView }) {
  if (turn.state === 'queued') return <>Queued</>;
  return turn.startedAt === null ? <>Working…</> : <>Working for <Since startedAt={turn.startedAt} /></>;
}

const isPending = (step: TurnStep): step is ApprovalStep => step.kind === 'approval' && step.ending === null;

/**
 * A background turn reading another agent's message: one quiet line beside the agent messages, opened in place
 * to show its steps and what it has written so far. An approval it asks for always shows: only the user can answer.
 */
function BackgroundTurn(props: {
  readonly turn: ActiveTurnView;
  readonly message: AgentMessage | undefined;
  readonly answering: readonly string[];
  readonly offline: boolean;
  readonly ctx: TimelineContext;
}) {
  const { turn, message, ctx } = props;
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const approval = approvalFor(ctx, props.answering, props.offline);
  return (
    <div class={`exchange background-turn${open ? ' open' : ''}`}>
      <button class="exchange-pill" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => { setOpen(!open); }}>
        <span class={`pulse ${turn.state}`} aria-hidden="true" />
        <span class="exchange-verb">{backgroundVerb(message)}</span>
        {message !== undefined && <Peer peers={ctx.peers} agentId={message.from.agentId} />}
        <span class="exchange-time"><Working turn={turn} /></span>
        <span class="exchange-chevron" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
      </button>
      {open && (
        <div id={bodyId} class="exchange-cards">
          <div class="exchange-body background-draft">
            <TurnSteps steps={turn.steps.filter((step) => !isPending(step))} display={ctx.display} approval={approval} />
            {turn.text === '' ? <div class="exchange-meta">Nothing written yet.</div> : <Markdown text={turn.text} actions={ctx.actions} />}
          </div>
        </div>
      )}
      {turn.steps.filter(isPending).map((step) => <div key={step.approval.approvalId} class="background-approval">{approval(step)}</div>)}
    </div>
  );
}

/**
 * The chat's messages from `start` on (spec §4.1): older ones load with "Show earlier", and the
 * running turn shows its timer, steps and streamed text.
 */
export function Timeline(props: {
  readonly view: ThreadView;
  readonly start: number;
  readonly answering: readonly string[];
  /** Nothing runs or sends, so the latest reply's Continue may run. */
  readonly idle: boolean;
  readonly locked: boolean;
  /** The host is reconnecting: actions that reach it wait. */
  readonly offline: boolean;
  readonly ctx: TimelineContext;
  readonly onShowEarlier: () => void;
}) {
  const { view, start, ctx } = props;
  const { messages, finished } = view;
  const unwatched = useMemo(() => messages.some((message) => message.kind === 'assistant' && !(message.id in finished)), [messages, finished]);
  const last = messages.at(-1);
  const steeredIn = useMemo(() => new Set(messages.flatMap((message, index) => (message.kind === 'user' && steered(messages[index - 1]) ? [message.id] : []))), [messages]);
  const items = useMemo(() => timelineItems(messages, view.agentMessages, view.subagents, start), [messages, view.agentMessages, view.subagents, start]);
  const active = view.activeTurn;
  const reading = active?.trigger.kind === 'agent-message' ? active.trigger.agentMessageId : null;
  const background = view.agentMessages.find(({ id }) => id === reading);
  return (
    <div class="messages" aria-label="Messages">
      {start > 0 && (
        <button class="ghost show-earlier" onClick={props.onShowEarlier}>
          Show earlier ({String(start)} more)
        </button>
      )}
      {unwatched && <div class="note muted reload-note">{TOOLS_NOT_KEPT}</div>}
      {items.map((item) => {
        switch (item.kind) {
          case 'exchange':
            return (
              <AgentExchange
                key={`exchange-${item.messages[0]?.id ?? ''}`}
                messages={item.messages}
                threadId={view.thread.id}
                peers={ctx.peers}
                actions={ctx.actions}
                readEnds={view.quietEnds}
              />
            );
          case 'subagents':
            return <SubagentGroup key={`subagents-${item.runs[0]?.id ?? ''}`} runs={item.runs} engine={ctx.engine} actions={ctx.actions} />;
          case 'message':
            return (
              <MessageItem
                key={item.message.id}
                message={item.message}
                finished={finished[item.message.id]}
                latest={item.message === last}
                steeredIn={steeredIn.has(item.message.id)}
                busy={item.message === last && (!props.idle || props.locked || props.offline)}
                ctx={ctx}
              />
            );
        }
      })}
      {active?.trigger.kind === 'chat' && <ActiveTurn turn={active} answering={props.answering} offline={props.offline} ctx={ctx} />}
      {active?.trigger.kind === 'agent-message' && (
        <BackgroundTurn
          turn={active}
          message={background}
          answering={props.answering}
          offline={props.offline}
          ctx={ctx}
        />
      )}
    </div>
  );
}
