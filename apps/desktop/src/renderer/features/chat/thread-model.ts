import type {
  BlockedGroup,
  ChatEvent,
  Cursor,
  Message,
  PendingApproval,
  Thread,
  ThreadState,
  TurnState,
} from '@morrowbot/contracts';

export interface ToolCall {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: unknown;
  readonly outcome: 'running' | 'ok' | 'error';
}

/** The turn that is queued or running, as the window shows it. */
export interface ActiveTurnView {
  readonly generationId: string;
  readonly state: TurnState;
  readonly queueNote: string | null;
  /** The provider's latest status line, such as "Thinking". */
  readonly detail: string | null;
  readonly text: string;
  /** Tool calls seen live; a reload shows only the text. */
  readonly tools: readonly ToolCall[];
  readonly approvals: readonly PendingApproval[];
}

/** A thread as the window shows it, kept in step with the host by its cursor. */
export interface ThreadView {
  readonly thread: Thread;
  readonly messages: readonly Message[];
  readonly activeTurn: ActiveTurnView | null;
  /** Approvals that ran out of time and were denied, while this window watched. */
  readonly expiredApprovals: readonly string[];
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

export function viewOf(state: ThreadState): ThreadView {
  const active = state.activeTurn;
  return {
    thread: state.thread,
    messages: state.messages,
    activeTurn:
      active === null
        ? null
        : {
            generationId: active.generationId,
            state: active.state,
            queueNote: active.queueNote,
            detail: null,
            text: active.text,
            tools: [],
            approvals: active.pendingApprovals,
          },
    expiredApprovals: [],
    blockedGroups: state.blockedGroups,
    cursor: state.cursor,
  };
}

/** Applies one thread event, only if it is the next one after the view's cursor. */
export function applyEvent(view: ThreadView, event: ThreadEvent): Applied {
  if (event.cursor.hostEpoch !== view.cursor.hostEpoch) return { kind: 'resync' };
  if (event.cursor.seq <= view.cursor.seq) return { kind: 'ignored' };
  if (event.cursor.seq !== view.cursor.seq + 1) return { kind: 'resync' };
  const next = change(view, event);
  return next === undefined ? { kind: 'resync' } : { kind: 'applied', view: { ...next, cursor: event.cursor } };
}

/** The view after `event`, or undefined when the event does not fit what the view knows. */
function change(view: ThreadView, event: ThreadEvent): ThreadView | undefined {
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
      tools: [],
      approvals: [],
    };
    return { ...view, messages, activeTurn, expiredApprovals: [] };
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
        tools: [...active.tools, { toolUseId: event.toolUseId, name: event.name, input: event.input, outcome: 'running' }],
      });
    case 'generation.tool-end':
      return turn({
        tools: active.tools.map((tool) => (tool.toolUseId === event.toolUseId ? { ...tool, outcome: event.outcome } : tool)),
      });
    case 'generation.approval-requested':
      return turn({ approvals: [...active.approvals.filter(({ approvalId }) => approvalId !== event.approval.approvalId), event.approval] });
    case 'generation.approval-resolved': {
      const resolved = active.approvals.find(({ approvalId }) => approvalId === event.approvalId);
      const next = turn({ approvals: active.approvals.filter(({ approvalId }) => approvalId !== event.approvalId) });
      return event.resolution.kind === 'expired' && resolved !== undefined
        ? { ...next, expiredApprovals: [...view.expiredApprovals, resolved.summary] }
        : next;
    }
    case 'generation.finished':
      return {
        ...view,
        messages: view.messages.some(({ id }) => id === event.message.id) ? view.messages : [...view.messages, event.message],
        activeTurn: null,
      };
  }
}
