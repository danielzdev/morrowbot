import type {
  ApprovalResolution,
  BlockedGroup,
  ChatEvent,
  Cursor,
  Message,
  PendingApproval,
  Thread,
  ThreadState,
  TurnState,
} from '@morrowbot/contracts';

/** A tool call seen live. Times are this window's own clock, in ms. `unfinished`: its turn ended with no end event for it. */
export interface ToolStep {
  readonly kind: 'tool';
  readonly toolUseId: string;
  readonly name: string;
  readonly input: unknown;
  readonly outcome: 'running' | 'ok' | 'error' | 'unfinished';
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
  readonly state: TurnState;
  readonly queueNote: string | null;
  /** The provider's latest status line, such as "Thinking". */
  readonly detail: string | null;
  readonly text: string;
  /** Tool calls seen live and every approval; a reload shows only the pending approvals. */
  readonly steps: readonly TurnStep[];
  /** When this window saw the turn start; null when it was already running at load. */
  readonly startedAt: number | null;
}

/** A turn that finished while this window watched it. */
export interface FinishedTurn {
  readonly steps: readonly TurnStep[];
  readonly durationMs: number | null;
}

/** A thread as the window shows it, kept in step with the host by its cursor. */
export interface ThreadView {
  readonly thread: Thread;
  readonly messages: readonly Message[];
  readonly activeTurn: ActiveTurnView | null;
  /** Turns watched to the end, by their reply's message id. Replies from before this window have none. */
  readonly finished: Readonly<Record<string, FinishedTurn>>;
  readonly blockedGroups: readonly BlockedGroup[];
  readonly cursor: Cursor;
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

/** A turn's steps once it has ended: pending requests end as cleared, running tools as unfinished. */
const settled = (steps: readonly TurnStep[]): TurnStep[] =>
  endPending(steps, CLEARED).map((step) => (step.kind === 'tool' && step.outcome === 'running' ? { ...step, outcome: 'unfinished' } : step));

/**
 * The view of a `/state` snapshot. Given the view it replaces (a resync), it keeps what only this
 * window saw: tool steps, timings and approval endings. A request that vanished without a known
 * ending ends as cleared, and a watched turn that ended during the gap keeps its steps on its reply.
 */
export function viewOf(state: ThreadState, previous: ThreadView | null = null): ThreadView {
  const active = state.activeTurn;
  const fresh: ActiveTurnView | null =
    active === null
      ? null
      : {
          generationId: active.generationId,
          state: active.state,
          queueNote: active.queueNote,
          detail: null,
          text: active.text,
          steps: active.pendingApprovals.map(pendingStep),
          startedAt: null,
        };
  const present = new Set(state.messages.map(({ id }) => id));
  const kept = Object.fromEntries(Object.entries(previous?.finished ?? {}).filter(([id]) => present.has(id)));
  const base = { thread: state.thread, messages: state.messages, blockedGroups: state.blockedGroups, cursor: state.cursor };
  const before = previous?.activeTurn ?? null;
  if (before === null || previous === null) return { ...base, activeTurn: fresh, finished: kept };
  if (fresh !== null && active !== null && fresh.generationId === before.generationId) {
    const pending = new Map(active.pendingApprovals.map((approval) => [approval.approvalId, approval]));
    const known = new Set(before.steps.flatMap((step) => (step.kind === 'approval' ? [step.approval.approvalId] : [])));
    const steps = [
      ...before.steps.map((step): TurnStep => {
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
  const finished = reply === undefined ? kept : { ...kept, [reply.id]: { steps: settled(before.steps), durationMs: null } };
  return { ...base, activeTurn: fresh, finished };
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
  if (event.kind === 'generation.started') {
    const messages = event.userMessage === null || view.messages.some(({ id }) => id === event.userMessage?.id)
      ? view.messages
      : [...view.messages, event.userMessage];
    const activeTurn: ActiveTurnView = {
      generationId: event.generationId,
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
    case 'generation.finished': {
      if (view.messages.some(({ id }) => id === event.message.id)) return { ...view, activeTurn: null };
      const record: FinishedTurn = { steps: settled(active.steps), durationMs: active.startedAt === null ? null : now - active.startedAt };
      return { ...view, messages: [...view.messages, event.message], activeTurn: null, finished: { ...view.finished, [event.message.id]: record } };
    }
  }
}
