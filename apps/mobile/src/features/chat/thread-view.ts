import type {
  ApprovalResolution,
  ChatEvent,
  Cursor,
  Message,
  PendingApproval,
  QueuedMessage,
  Thread,
  ThreadState,
  TurnState,
  TurnTrigger,
} from '@morrowbot/contracts';

/** A tool call seen live. `unfinished`: its turn ended with no end event; `unknown`: it ended during a resync. */
export interface ToolStep {
  readonly kind: 'tool';
  readonly toolUseId: string;
  readonly name: string;
  readonly input: unknown;
  readonly outcome: 'running' | 'ok' | 'error' | 'unfinished' | 'unknown';
}

/** How an approval request ended. `late`: the answer reached the host after the request had ended. */
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

export type TurnStep = ToolStep | ApprovalStep;

export interface ActiveTurnView {
  readonly generationId: string;
  /** `agent-message`: a background turn answering another agent; its text is not a reply to the user. */
  readonly trigger: TurnTrigger;
  readonly state: TurnState;
  readonly queueNote: string | null;
  /** The provider's latest status line, such as "Thinking". */
  readonly detail: string | null;
  readonly text: string;
  readonly steps: readonly TurnStep[];
}

/** A thread as the phone shows it, kept in step with the host by its cursor. */
export interface ThreadView {
  readonly thread: Thread;
  readonly messages: readonly Message[];
  readonly activeTurn: ActiveTurnView | null;
  /** Steps of turns watched to the end, by their reply's message id. */
  readonly finished: Readonly<Record<string, readonly TurnStep[]>>;
  /** Messages sent during a running turn that the agent has not seen yet. */
  readonly queue: readonly QueuedMessage[];
  readonly cursor: Cursor;
}

export type ThreadEvent = Exclude<ChatEvent, { kind: 'usage.updated' }>;

/** `ignored`: already reflected (a replay overlap). `resync`: another host run or a missed event. */
export type Applied =
  | { readonly kind: 'applied'; readonly view: ThreadView }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'resync' };

const CLEARED: ApprovalEnding = { kind: 'cleared' };

const pendingStep = (approval: PendingApproval): ApprovalStep => ({ kind: 'approval', approval, ending: null });

export function pendingApprovals(turn: ActiveTurnView | null): PendingApproval[] {
  return (turn?.steps ?? []).flatMap((step) => (step.kind === 'approval' && step.ending === null ? [step.approval] : []));
}

function endPending(steps: readonly TurnStep[], ending: ApprovalEnding, only: (approvalId: string) => boolean): TurnStep[] {
  return steps.map((step) =>
    step.kind === 'approval' && step.ending === null && only(step.approval.approvalId) ? { ...step, ending } : step,
  );
}

/** A turn's steps once it has ended: pending requests end as cleared, running tools as `left`. */
function settled(steps: readonly TurnStep[], left: 'unfinished' | 'unknown'): TurnStep[] {
  return endPending(steps, CLEARED, () => true).map((step) =>
    step.kind === 'tool' && step.outcome === 'running' ? { ...step, outcome: left } : step,
  );
}

/**
 * The view of a `/state` snapshot. Given the view it replaces (a resync or a stale-card reload), it
 * keeps what only this phone saw: tool steps and approval endings. A request that vanished without a
 * known ending ends as cleared, so a stale card never keeps live buttons.
 */
export function viewOf(state: ThreadState, previous: ThreadView | null = null): ThreadView {
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
          steps: active.pendingApprovals.map(pendingStep),
        };
  const present = new Set(state.messages.map(({ id }) => id));
  const kept = Object.fromEntries(Object.entries(previous?.finished ?? {}).filter(([id]) => present.has(id)));
  const base = { thread: state.thread, messages: state.messages, queue: state.queue, cursor: state.cursor };
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
    return { ...base, activeTurn: { ...fresh, detail: before.detail, steps }, finished: kept };
  }
  const seen = new Set(previous.messages.map(({ id }) => id));
  const reply = state.messages.find(({ id, kind }) => kind === 'assistant' && !seen.has(id));
  const finished = reply === undefined ? kept : { ...kept, [reply.id]: settled(before.steps, 'unknown') };
  return { ...base, activeTurn: fresh, finished };
}

/** Applies one thread event, only if it is the next one after the view's cursor. */
export function applyEvent(view: ThreadView, event: ThreadEvent): Applied {
  if (event.cursor.hostEpoch !== view.cursor.hostEpoch) return { kind: 'resync' };
  if (event.cursor.seq <= view.cursor.seq) return { kind: 'ignored' };
  if (event.cursor.seq !== view.cursor.seq + 1) return { kind: 'resync' };
  const next = change(view, event);
  return next === undefined ? { kind: 'resync' } : { kind: 'applied', view: { ...next, cursor: event.cursor } };
}

/** The view after the user's answer reached the host too late: that card shows "already ended". */
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

function change(view: ThreadView, event: ThreadEvent): ThreadView | undefined {
  if (event.kind === 'queue.changed') return { ...view, queue: event.queue };
  if (event.kind === 'reactions.changed') return view;
  if (event.kind === 'subagent.changed') return view;
  if (event.kind === 'card.changed') return view;
  if (event.kind === 'generation.started' || event.kind === 'generation.background-started') {
    const userMessage = event.kind === 'generation.started' ? event.userMessage : null;
    const messages =
      userMessage === null || view.messages.some(({ id }) => id === userMessage.id) ? view.messages : [...view.messages, userMessage];
    const trigger: TurnTrigger =
      event.kind === 'generation.started' ? { kind: 'chat' } : { kind: 'agent-message', agentMessageId: event.agentMessageId };
    return {
      ...view,
      messages,
      activeTurn: { generationId: event.generationId, trigger, state: event.state, queueNote: null, detail: null, text: '', steps: [] },
    };
  }
  const active = view.activeTurn;
  if (active?.generationId !== event.generationId) return undefined;
  const turn = (patch: Partial<ActiveTurnView>): ThreadView => ({ ...view, activeTurn: { ...active, ...patch } });
  const isApproval = (step: TurnStep, approvalId: string): step is ApprovalStep =>
    step.kind === 'approval' && step.approval.approvalId === approvalId;
  switch (event.kind) {
    case 'generation.status':
      return turn({ state: event.state, queueNote: event.queueNote, detail: event.detail ?? active.detail });
    case 'generation.delta':
      return turn({ text: active.text + event.text });
    case 'generation.tool-start':
      return turn({
        steps: [...active.steps, { kind: 'tool', toolUseId: event.toolUseId, name: event.name, input: event.input, outcome: 'running' }],
      });
    case 'generation.tool-end':
      return turn({
        steps: active.steps.map((step) =>
          step.kind === 'tool' && step.toolUseId === event.toolUseId ? { ...step, outcome: event.outcome } : step,
        ),
      });
    case 'generation.approval-requested': {
      const { approval } = event;
      const known = active.steps.some((step) => isApproval(step, approval.approvalId));
      return turn({
        steps: known
          ? active.steps.map((step) => (isApproval(step, approval.approvalId) ? pendingStep(approval) : step))
          : [...active.steps, pendingStep(approval)],
      });
    }
    case 'generation.approval-resolved':
      return turn({
        steps: active.steps.map((step) =>
          isApproval(step, event.approvalId) && (step.ending === null || step.ending.kind === 'late')
            ? { ...step, ending: endingOf(event.resolution, step.approval) }
            : step,
        ),
      });
    case 'generation.steered': {
      const { segment, userMessage } = event;
      return {
        ...view,
        messages: [...view.messages, segment, userMessage],
        activeTurn: { ...active, text: '', steps: [], detail: null },
        finished: { ...view.finished, [segment.id]: settled(active.steps, 'unfinished') },
      };
    }
    case 'generation.finished': {
      if (view.messages.some(({ id }) => id === event.message.id)) return { ...view, activeTurn: null };
      return {
        ...view,
        messages: [...view.messages, event.message],
        activeTurn: null,
        finished: { ...view.finished, [event.message.id]: settled(active.steps, 'unfinished') },
      };
    }
    case 'generation.background-finished':
      return { ...view, activeTurn: null };
  }
}
