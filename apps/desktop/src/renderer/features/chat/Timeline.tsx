import type { Message } from '@morrowbot/contracts';
import { memo } from 'preact/compat';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ApprovalCard } from './ApprovalCard.tsx';
import type { ChatDisplay } from './display.ts';
import { ACTIVE_ID } from './find.ts';
import { Markdown, type MarkdownActions } from './Markdown.tsx';
import { outcomeCopy, type CopyContext, type OutcomeAction } from './outcome-copy.ts';
import { OutcomeNote } from './OutcomeNote.tsx';
import { SentAttachments } from './SentAttachments.tsx';
import type { ActiveTurnView, ApprovalStep, FinishedTurn, ThreadView } from './thread-model.ts';
import { TurnSteps } from './ToolGroup.tsx';
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

const MessageItem = memo(function MessageItem(props: {
  readonly message: Message;
  readonly finished: FinishedTurn | undefined;
  readonly latest: boolean;
  readonly busy: boolean;
  readonly ctx: TimelineContext;
}) {
  const { message, finished, ctx } = props;
  if (message.kind === 'user') {
    return (
      <div class="message user" data-message-id={message.id}>
        {message.attachments.length > 0 && <SentAttachments attachments={message.attachments} image={ctx.image} />}
        {message.text !== '' && <div class="bubble" data-find-id={message.id}>{message.text}</div>}
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
  const queued = turn.state === 'queued';
  const detail = queued ? (turn.queueNote ?? 'Queued: waiting for a free slot') : turn.detail;
  return (
    <div class="message assistant active">
      <div class={`turn-time ${turn.state}`}>
        <span class="pulse" aria-hidden="true" />
        {queued ? 'Queued' : turn.startedAt === null ? 'Working…' : <>Working for <Since startedAt={turn.startedAt} /></>}
        {detail !== null && <span class="turn-detail"> · {ctx.display.safe(detail) ?? ''}</span>}
      </div>
      <TurnSteps steps={turn.steps} display={ctx.display} approval={approvalFor(ctx, props.answering, props.offline)} />
      {turn.text !== '' && <div data-find-id={ACTIVE_ID}><Markdown text={turn.text} actions={ctx.actions} /></div>}
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
  return (
    <div class="messages" aria-label="Messages">
      {start > 0 && (
        <button class="ghost show-earlier" onClick={props.onShowEarlier}>
          Show earlier ({String(start)} more)
        </button>
      )}
      {unwatched && <div class="note muted reload-note">{TOOLS_NOT_KEPT}</div>}
      {messages.slice(start).map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          finished={finished[message.id]}
          latest={message === last}
          busy={message === last && (!props.idle || props.locked || props.offline)}
          ctx={ctx}
        />
      ))}
      {view.activeTurn !== null && <ActiveTurn turn={view.activeTurn} answering={props.answering} offline={props.offline} ctx={ctx} />}
    </div>
  );
}
