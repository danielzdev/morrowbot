import type {
  AgentMessage,
  AgentMessageReadOutcome,
  ApprovalResolution,
  BlockedGroup,
  ChatEvent,
  Cursor,
  Message,
  MessageReaction,
  PendingApproval,
  QueuedMessage,
  SubagentRun,
  Thread,
  ThreadCard,
  ThreadState,
  TurnState,
  TurnTrigger,
} from '@morrowbot/contracts';
import { replaceReactions } from './reactions.ts';
import { fromSaved, withSaved } from './saved-tools.ts';
import { settleCards, withCard } from './thread-cards.ts';

/**
 * A tool call seen live or saved by the host. Times are ms; only differences between them are shown. `unfinished`:
 * its turn ended with no end for it. `unknown`: its turn ended while this window was resyncing and the host saved
 * no result for it.
 */
export interface ToolStep {
  readonly kind: 'tool';
  readonly toolUseId: string;
  readonly name: string;
  readonly input: unknown;
  readonly outcome: 'running' | 'ok' | 'error' | 'unfinished' | 'unknown';
  readonly startedAt: number;
  readonly endedAt: number | null;
}

/** How an approval request ended (spec §4.3). `late`: the user's answer reached the host after the request ended. */
export type ApprovalEnding =
  | { readonly kind: 'chosen'; readonly label: string }
  | { readonly kind: 'expired' }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'late' };

export interface ApprovalStep {
  readonly kind: 'approval';
  readonly approval: PendingApproval;
  /** Null while the host reports it pending. */
  readonly ending: ApprovalEnding | null;
}

/** One step of a turn, in the order it arrived. */
export type TurnStep = ToolStep | ApprovalStep;

/** The turn that is queued or running, as the window shows it. */
export interface ActiveTurnView {
  readonly generationId: string;
  /** `agent-message`: a background turn, shown with the agent messages instead of as a reply. */
  readonly trigger: TurnTrigger;
  readonly state: TurnState;
  readonly queueNote: string | null;
  /** The provider's latest status line, such as "Thinking". */
  readonly detail: string | null;
  readonly text: string;
  /** Tool calls and approvals; a reload shows the tool calls the host saved and only the pending approvals. */
  readonly steps: readonly TurnStep[];
  /** When this window saw the turn start; null when it was already running at load. */
  readonly startedAt: number | null;
}

/** A turn that finished: watched by this window, or loaded from the host's saved tool calls (no duration). */
export interface FinishedTurn {
  readonly steps: readonly TurnStep[];
  readonly durationMs: number | null;
}

/** A thread as the window shows it, kept in step with the host by its cursor. */
export interface ThreadView {
  readonly thread: Thread;
  readonly messages: readonly Message[];
  /** Every reaction on the messages, oldest first. */
  readonly reactions: readonly MessageReaction[];
  readonly activeTurn: ActiveTurnView | null;
  /** Finished turns by their reply's message id. A reply that called no tools, and was not watched, has none. */
  readonly finished: Readonly<Record<string, FinishedTurn>>;
  /** Messages the agent has not seen yet, oldest first. */
  readonly queue: readonly QueuedMessage[];
  readonly blockedGroups: readonly BlockedGroup[];
  readonly cursor: Cursor;
  /** Messages this chat's agent sent or received here from other agents, oldest first. */
  readonly agentMessages: readonly AgentMessage[];
  /** How background turns reading this chat's incoming agent messages ended, by agent message id (saved by the host or watched live). */
  readonly quietEnds: Readonly<Record<string, AgentMessageReadOutcome>>;
  /** The sub-agents this chat's turns started, oldest first. */
  readonly subagents: readonly SubagentRun[];
  /** The cards agents put in this chat (`/api/ui/v1`), oldest first: on saved replies, or the running turn's. */
  readonly cards: readonly ThreadCard[];
}

export type ThreadEvent = Exclude<ChatEvent, { kind: 'usage.updated' }>;

/**
 * `applied`: the next event in order. `ignored`: one already reflected (a replay overlap).
 * `resync`: another host run or a missed event; refetch `/state`.
 */
export type Applied =
  | { readonly kind: 'applied'; readonly view: ThreadView }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'resync' };

const CLEARED: ApprovalEnding = { kind: 'cleared' };

export function pendingApprovals(turn: ActiveTurnView): PendingApproval[] {
  return turn.steps.flatMap((step) => (step.kind === 'approval' && step.ending === null ? [step.approval] : []));
}

const pendingStep = (approval: PendingApproval): ApprovalStep => ({ kind: 'approval', approval, ending: null });

/** Every approval still pending in `steps` ends with `ending`. */
function endPending(steps: readonly TurnStep[], ending: ApprovalEnding, only?: (approvalId: string) => boolean): TurnStep[] {
  return steps.map((step) =>
    step.kind === 'approval' && step.ending === null && (only?.(step.approval.approvalId) ?? true) ? { ...step, ending } : step,
  );
}

/** A turn's steps once it has ended: pending requests end as cleared, running tools as `left`. */
const settled = (steps: readonly TurnStep[], left: 'unfinished' | 'unknown'): TurnStep[] =>
  endPending(steps, CLEARED).map((step) => (step.kind === 'tool' && step.outcome === 'running' ? { ...step, outcome: left } : step));

/**
 * The view of a `/state` snapshot, with the tool calls the host saved. Given the view it replaces (a resync), it
 * keeps what only this window saw: timings and approval endings. A request that vanished without a known ending
 * ends as cleared, and a watched turn that ended during the gap keeps its steps on its reply.
 */
export function viewOf(
  state: ThreadState,
  previous: ThreadView | null = null,
  agentMessages: readonly AgentMessage[] = previous?.agentMessages ?? [],
  cards: readonly ThreadCard[] = previous?.cards ?? [],
): ThreadView {
  const active = state.activeTurn;
  const fresh: ActiveTurnView | null =
    active === null
      ? null
      : {
          generationId: active.generationId,
          trigger: active.trigger,
          state: active.state,
          queueNote: active.queueNote,
          detail: null,
          text: active.text,
          steps: [...active.toolSteps.map(fromSaved), ...active.pendingApprovals.map(pendingStep)],
          startedAt: null,
        };
  const present = new Set(state.messages.map(({ id }) => id));
  const saved = new Map(state.toolSteps.map(({ messageId, steps }) => [messageId, steps]));
  const loaded = Object.fromEntries(state.toolSteps.map(({ messageId, steps }): [string, FinishedTurn] => [messageId, { steps: steps.map(fromSaved), durationMs: null }]));
  const watched = Object.entries(previous?.finished ?? {}).flatMap(([id, record]): [string, FinishedTurn][] =>
    present.has(id) ? [[id, { ...record, steps: withSaved(record.steps, saved.get(id) ?? []) }]] : [],
  );
  const kept = { ...loaded, ...Object.fromEntries(watched) };
  const savedReadEnds = readEndsOf(state.thread.id, agentMessages);
  const base = {
    thread: state.thread,
    messages: state.messages,
    reactions: state.reactions,
    queue: state.queue,
    blockedGroups: state.blockedGroups,
    subagents: state.subagents,
    cursor: state.cursor,
    agentMessages,
    quietEnds: { ...previous?.quietEnds, ...savedReadEnds },
    cards,
  };
  const before = previous?.activeTurn ?? null;
  if (before === null || previous === null) return { ...base, activeTurn: fresh, finished: kept };
  if (fresh !== null && active !== null && fresh.generationId === before.generationId) {
    const pending = new Map(active.pendingApprovals.map((approval) => [approval.approvalId, approval]));
    const known = new Set(before.steps.flatMap((step) => (step.kind === 'approval' ? [step.approval.approvalId] : [])));
    const steps = [
      ...withSaved(before.steps, active.toolSteps).map((step): TurnStep => {
        if (step.kind !== 'approval') return step;
        const current = pending.get(step.approval.approvalId);
        if (current !== undefined) return pendingStep(current);
        return step.ending === null ? { ...step, ending: CLEARED } : step;
      }),
      ...active.pendingApprovals.filter(({ approvalId }) => !known.has(approvalId)).map(pendingStep),
    ];
    return { ...base, activeTurn: { ...fresh, detail: before.detail, steps, startedAt: before.startedAt }, finished: kept };
  }
  const seen = new Set(previous.messages.map(({ id }) => id));
  const reply = state.messages.find(({ id, kind }) => kind === 'assistant' && !seen.has(id));
  const finished = reply === undefined ? kept : { ...kept, [reply.id]: { steps: settled(withSaved(before.steps, saved.get(reply.id) ?? []), 'unknown'), durationMs: null } };
  return { ...base, activeTurn: fresh, finished };
}

const byTime = (a: AgentMessage, b: AgentMessage): number => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

function readEndsOf(threadId: string, messages: readonly AgentMessage[]): Record<string, AgentMessageReadOutcome> {
  return Object.fromEntries(
    messages.flatMap((message): [string, AgentMessageReadOutcome][] =>
      message.to.threadId === threadId && message.readOutcome !== undefined ? [[message.id, message.readOutcome]] : [],
    ),
  );
}

/** The view with agent messages added: only those shown in this chat, each once, in time order. */
export function withAgentMessages(view: ThreadView, messages: readonly AgentMessage[]): ThreadView {
  const known = new Set(view.agentMessages.map(({ id }) => id));
  const here = messages.filter(({ id, from, to }) => !known.has(id) && (from.threadId === view.thread.id || to.threadId === view.thread.id));
  if (here.length === 0) return view;
  const addedEnds = readEndsOf(view.thread.id, here);
  return {
    ...view,
    agentMessages: [...view.agentMessages, ...here].sort(byTime),
    quietEnds: Object.keys(addedEnds).length === 0 ? view.quietEnds : { ...view.quietEnds, ...addedEnds },
  };
}

/** The runs with `run` in place of the one with its id, or added last. */
function withRun(runs: readonly SubagentRun[], run: SubagentRun): SubagentRun[] {
  return runs.some(({ id }) => id === run.id) ? runs.map((each) => (each.id === run.id ? run : each)) : [...runs, run];
}

/** Applies one thread event, only if it is the next one after the view's cursor. `now` is this window's clock. */
export function applyEvent(view: ThreadView, event: ThreadEvent, now: number): Applied {
  if (event.cursor.hostEpoch !== view.cursor.hostEpoch) return { kind: 'resync' };
  if (event.cursor.seq <= view.cursor.seq) return { kind: 'ignored' };
  if (event.cursor.seq !== view.cursor.seq + 1) return { kind: 'resync' };
  const next = change(view, event, now);
  return next === undefined ? { kind: 'resync' } : { kind: 'applied', view: { ...next, cursor: event.cursor } };
}

/** The view after the user's answer reached the host too late: that request shows "already ended". */
export function endApproval(view: ThreadView, approvalId: string, ending: ApprovalEnding): ThreadView {
  const active = view.activeTurn;
  if (active === null) return view;
  return { ...view, activeTurn: { ...active, steps: endPending(active.steps, ending, (id) => id === approvalId) } };
}

function endingOf(resolution: ApprovalResolution, approval: PendingApproval): ApprovalEnding {
  switch (resolution.kind) {
    case 'chosen':
      return { kind: 'chosen', label: approval.choices.find(({ id }) => id === resolution.choiceId)?.label ?? resolution.choiceId };
    case 'expired':
      return { kind: 'expired' };
    case 'cleared':
      return CLEARED;
  }
}

/** The view after `event`, or undefined when the event does not fit what the view knows. */
function change(view: ThreadView, event: ThreadEvent, now: number): ThreadView | undefined {
  if (event.kind === 'queue.changed') return { ...view, queue: event.queue };
  if (event.kind === 'reactions.changed') return { ...view, reactions: replaceReactions(view.reactions, event.messageId, event.reactions) };
  if (event.kind === 'subagent.changed') return { ...view, subagents: withRun(view.subagents, event.run) };
  if (event.kind === 'card.changed') return { ...view, cards: withCard(view.cards, event.card) };
  if (event.kind === 'generation.started' || event.kind === 'generation.background-started') {
    const started = event.kind === 'generation.started' ? event.userMessage : null;
    const messages = started === null || view.messages.some(({ id }) => id === started.id) ? view.messages : [...view.messages, started];
    const activeTurn: ActiveTurnView = {
      generationId: event.generationId,
      trigger: event.kind === 'generation.started' ? { kind: 'chat' } : { kind: 'agent-message', agentMessageId: event.agentMessageId },
      state: event.state,
      queueNote: null,
      detail: null,
      text: '',
      steps: [],
      startedAt: now,
    };
    return { ...view, messages, activeTurn };
  }
  const active = view.activeTurn;
  if (active?.generationId !== event.generationId) return undefined;
  const turn = (patch: Partial<ActiveTurnView>): ThreadView => ({ ...view, activeTurn: { ...active, ...patch } });
  switch (event.kind) {
    case 'generation.status':
      return turn({ state: event.state, queueNote: event.queueNote, detail: event.detail ?? active.detail });
    case 'generation.delta':
      return turn({ text: active.text + event.text });
    case 'generation.tool-start':
      return turn({
        steps: [
          ...active.steps,
          { kind: 'tool', toolUseId: event.toolUseId, name: event.name, input: event.input, outcome: 'running', startedAt: now, endedAt: null },
        ],
      });
    case 'generation.tool-end':
      return turn({
        steps: active.steps.map((step) =>
          step.kind === 'tool' && step.toolUseId === event.toolUseId ? { ...step, outcome: event.outcome, endedAt: now } : step,
        ),
      });
    case 'generation.approval-requested': {
      const { approval } = event;
      const known = active.steps.some((step) => step.kind === 'approval' && step.approval.approvalId === approval.approvalId);
      return turn({
        steps: known
          ? active.steps.map((step) => (step.kind === 'approval' && step.approval.approvalId === approval.approvalId ? pendingStep(approval) : step))
          : [...active.steps, pendingStep(approval)],
      });
    }
    case 'generation.approval-resolved':
      return turn({
        steps: active.steps.map((step) =>
          step.kind === 'approval' && (step.ending === null || step.ending.kind === 'late') && step.approval.approvalId === event.approvalId
            ? { ...step, ending: endingOf(event.resolution, step.approval) }
            : step,
        ),
      });
    case 'generation.steered': {
      const { segment, userMessage } = event;
      const record: FinishedTurn = { steps: settled(active.steps, 'unfinished'), durationMs: active.startedAt === null ? null : now - active.startedAt };
      return {
        ...view,
        messages: [...view.messages, segment, userMessage],
        cards: settleCards(view.cards, active.generationId, segment.id),
        activeTurn: { ...active, text: '', steps: [], detail: null, startedAt: now },
        finished: { ...view.finished, [segment.id]: record },
      };
    }
    case 'generation.finished': {
      const cards = settleCards(view.cards, active.generationId, event.message.id);
      if (view.messages.some(({ id }) => id === event.message.id)) return { ...view, cards, activeTurn: null };
      const record: FinishedTurn = { steps: settled(active.steps, 'unfinished'), durationMs: active.startedAt === null ? null : now - active.startedAt };
      return { ...view, cards, messages: [...view.messages, event.message], activeTurn: null, finished: { ...view.finished, [event.message.id]: record } };
    }
    case 'generation.background-finished': {
      const { trigger } = active;
      const cards = settleCards(view.cards, active.generationId, null);
      if (trigger.kind === 'chat') return { ...view, cards, activeTurn: null };
      return { ...view, cards, activeTurn: null, quietEnds: { ...view.quietEnds, [trigger.agentMessageId]: event.outcome.kind } };
    }
  }
}
