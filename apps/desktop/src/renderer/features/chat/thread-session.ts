import { MAX_ATTACHMENTS, type AgentMessage, type ApiError, type AssistantMessage, type CardAction, type EventServerFrame, type SessionChoice, type SessionChoiceReason, type ThreadCard, type ThreadState } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api, ApiResult } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';
import { attachmentImages, composerAttachments, type ComposerAttachments } from './composer-attachments.ts';
import { memoryDrafts, type DraftStore } from './drafts.ts';
import type { BannerReason } from './outcome-copy.ts';
import { userReacted } from './reactions.ts';
import { withCard } from './thread-cards.ts';
import { applyEvent, endApproval, pendingApprovals, viewOf, withAgentMessages, type ThreadView } from './thread-model.ts';

/** Something the composer asked the host to start. Kept so it can be retried exactly. */
export type PendingAction =
  | { readonly kind: 'send'; readonly text: string; readonly attachmentIds: readonly string[] }
  | { readonly kind: 'continue'; readonly failedMessageId: string };

/** Why the last send or Continue did not start. In every case the host wrote nothing, so the draft stays. */
export type ComposerProblem =
  | { readonly kind: 'session-choice'; readonly reason: SessionChoiceReason; readonly action: PendingAction }
  | { readonly kind: 'retry'; readonly reason: BannerReason; readonly action: PendingAction; readonly sessionChoice: SessionChoice }
  /** `message` is the host's own text; it is redacted before display. */
  | { readonly kind: 'error'; readonly message: string };

export interface ThreadScreen {
  readonly view: Loadable<ThreadView>;
  readonly draft: string;
  readonly busy: 'sending' | 'stopping' | null;
  readonly problem: ComposerProblem | null;
  /** Approval ids whose answer is on its way to the host. */
  readonly answering: readonly string[];
  /** Queued messages whose Steer now, Edit or Cancel is on its way to the host. */
  readonly queueActing: readonly string[];
  /** Cards whose click is on its way to the host. */
  readonly cardActing: readonly string[];
  /** `reconnecting`: the host can't be reached; the loaded history stays readable and sending waits. */
  readonly connection: 'live' | 'reconnecting';
}

export interface ThreadSession {
  readonly threadId: string;
  readonly screen: Store<ThreadScreen>;
  /** The files waiting above the message box for the next send. */
  readonly attachments: ComposerAttachments;
  /** A sent image as a data URL, for the chat's bubbles; null when it can't be loaded. */
  readonly image: (id: string) => Promise<string | null>;
  /** Fetches `/state`, replaces the view, and follows events from its cursor. */
  load(): Promise<void>;
  /** A frame from the host's event stream. */
  handle(frame: EventServerFrame): void;
  /** The event stream dropped (false) or is back (true, which reloads): while it is down the chat says it is reconnecting. */
  setStream(up: boolean): void;
  setDraft(text: string): void;
  send(): Promise<void>;
  /** Runs the refused action again with the user's session choice. */
  choose(choice: SessionChoice): Promise<void>;
  /** Runs the refused action again as it was. */
  retry(): Promise<void>;
  dismissProblem(): void;
  continueTurn(failedMessageId: string, sessionChoice: SessionChoice): Promise<void>;
  stop(): Promise<void>;
  answer(approvalId: string, choiceId: string): Promise<void>;
  /** Puts the user's emoji on an agent reply, or takes it off when it is already there. */
  react(messageId: string, emoji: string): Promise<void>;
  /** The user's click on a card: a choice, Install, Cancel, or a setting switch. True when the host took it. */
  actOnCard(cardId: string, action: CardAction): Promise<boolean>;
  /** Steer now: the queued message goes into the running reply, or out as the next turn when nothing runs. */
  steer(queuedId: string): Promise<void>;
  /** Takes a queued message out of the queue and puts it back in the draft, above what is typed there. */
  editQueued(queuedId: string): Promise<void>;
  cancelQueued(queuedId: string): Promise<void>;
  release(regId: string): Promise<void>;
  close(): void;
}

export interface ThreadSessionOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'subscribe' | 'unsubscribe'>;
  readonly threadId: string;
  readonly onFinished?: (message: AssistantMessage) => void;
  /** How often a thread blocked by an old process group checks again; Release anyway appears after 60 s. */
  readonly blockedRefreshMs?: number;
  /** After a Stop or Release, which can block or free process groups that other screens show too. */
  readonly onGroupsChanged?: () => void;
  /** Where the draft is kept, so it survives a reload. */
  readonly drafts?: DraftStore;
  /** How often an unreachable host is tried again. */
  readonly reconnectMs?: number;
  /** This window's clock, for tool and turn timings. */
  readonly now?: () => number;
}

export function problemOf(error: ApiError['error'], action: PendingAction, choice: SessionChoice): ComposerProblem {
  switch (error.kind) {
    case 'session-choice-required':
      return { kind: 'session-choice', reason: error.reason, action };
    case 'provider-unavailable':
      return { kind: 'retry', reason: error.reason, action, sessionChoice: choice };
    case 'binding-changed':
      return { kind: 'retry', reason: 'binding-changed', action, sessionChoice: choice };
    case 'invalid_request':
    case 'not_found':
    case 'conflict':
    case 'forbidden':
    case 'unauthorized':
    case 'internal':
    case 'instructions-conflict':
    case 'scope-conflict':
    case 'agent-conflict':
      return { kind: 'error', message: error.message };
  }
}

/** A failed load that means the host is down or restarting, rather than a refusal. */
/** The host itself is away (no answer, or the proxy's 502–504), as opposed to an error it reported. */
const unreachable = (status: number): boolean => status === 0 || (status >= 502 && status <= 504);

const stillPending = (view: ThreadScreen['view'], approvalId: string): boolean =>
  view.kind === 'loaded' && view.value.activeTurn !== null && pendingApprovals(view.value.activeTurn).some((approval) => approval.approvalId === approvalId);

/** This window already shows how the approval ended, so the host's 404 to another answer for it is no news. */
const shownEnded = (view: ThreadScreen['view'], approvalId: string): boolean =>
  view.kind === 'loaded' &&
  (view.value.activeTurn?.steps.some((step) => step.kind === 'approval' && step.approval.approvalId === approvalId && step.ending !== null) ?? false);

export function openThreadSession(options: ThreadSessionOptions): ThreadSession {
  const { api, bridge, threadId } = options;
  const drafts = options.drafts ?? memoryDrafts();
  const now = options.now ?? Date.now;
  const screen = new Store<ThreadScreen>({ view: { kind: 'loading' }, draft: drafts.read(threadId), busy: null, problem: null, answering: [], queueActing: [], cardActing: [], connection: 'live' });
  const patch = (change: Partial<ThreadScreen>): void => {
    if (change.draft !== undefined && change.draft !== screen.get().draft) drafts.write(threadId, change.draft);
    screen.update((current) => {
      const next = { ...current, ...change };
      return change.view === undefined ? next : { ...next, answering: next.answering.filter((id) => stillPending(next.view, id)) };
    });
  };
  const attachments = composerAttachments(api, threadId);
  const image = attachmentImages(api);
  let streamUp = true;
  let loads = 0;
  let loading = false;
  let closed = false;
  let blockedTimer: ReturnType<typeof setTimeout> | undefined;
  /** Agent messages announced while a load is in flight, so none falls between its fetch and live delivery. */
  let heard: AgentMessage[] = [];

  /** The chat's `/state`, its agent messages and its cards (none from a host older than cards): all three, or the first failure. */
  async function snapshot(): Promise<
    ApiResult<{ readonly state: ThreadState; readonly agentMessages: readonly AgentMessage[]; readonly cards: readonly ThreadCard[] }>
  > {
    const state = await api.threadState(threadId);
    if (state.kind === 'failed') return state;
    const exchanged = await api.agentMessages(state.value.thread.agentId, threadId);
    if (exchanged.kind === 'failed') return exchanged;
    const cards = await api.threadCards(threadId);
    if (cards.kind === 'failed' && cards.status !== 404) return cards;
    return { kind: 'ok', value: { state: state.value, agentMessages: exchanged.value.messages, cards: cards.kind === 'ok' ? cards.value.cards : [] } };
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    loading = true;
    clearTimeout(blockedTimer);
    bridge.unsubscribe(threadId);
    heard = [];
    const result = await snapshot();
    if (mine !== loads || closed) return;
    loading = false;
    const before = screen.get().view;
    if (result.kind === 'failed') {
      if (before.kind === 'loaded' && unreachable(result.status)) {
        patch({ connection: 'reconnecting' });
        blockedTimer = setTimeout(() => void load(), options.reconnectMs ?? 2_000);
        return;
      }
      patch({ connection: streamUp ? 'live' : 'reconnecting', view: { kind: 'failed', message: result.status === 404 ? 'This chat no longer exists.' : result.error.message } });
      return;
    }
    const previous = before.kind === 'loaded' ? before.value : null;
    const view = withAgentMessages(viewOf(result.value.state, previous, result.value.agentMessages, result.value.cards), heard);
    heard = [];
    patch({ connection: streamUp ? 'live' : 'reconnecting', view: { kind: 'loaded', value: view } });
    bridge.subscribe(threadId, result.value.state.cursor);
    if (view.blockedGroups.length > 0) {
      blockedTimer = setTimeout(() => void load(), options.blockedRefreshMs ?? 5_000);
    }
  }

  /** Events were missed: the chat says it is reconnecting, and holds Send, until the snapshot is in. */
  function resync(): void {
    if (screen.get().view.kind === 'loaded') patch({ connection: 'reconnecting' });
    void load();
  }

  function hear(message: AgentMessage): void {
    const current = screen.get().view;
    if (loading || current.kind !== 'loaded') heard.push(message);
    else patch({ view: { kind: 'loaded', value: withAgentMessages(current.value, [message]) } });
  }

  function handle(frame: EventServerFrame): void {
    if (closed || frame.kind === 'usage.updated' || frame.kind === 'thread.changed') return;
    if (frame.kind === 'agent-message.posted') {
      hear(frame.message);
      return;
    }
    if (frame.threadId !== threadId) return;
    if (frame.kind === 'resync') {
      resync();
      return;
    }
    const current = screen.get().view;
    if (loading || current.kind !== 'loaded') return;
    const applied = applyEvent(current.value, frame, now());
    switch (applied.kind) {
      case 'ignored':
        return;
      case 'resync':
        resync();
        return;
      case 'applied':
        patch({ view: { kind: 'loaded', value: applied.view } });
        if (frame.kind === 'generation.finished' || frame.kind === 'message.posted') {
          options.onFinished?.(frame.message);
          if (frame.kind === 'generation.finished' && frame.message.outcome.kind === 'interrupted') void load();
        }
        return;
    }
  }

  async function run(action: PendingAction, sessionChoice: SessionChoice): Promise<void> {
    if (screen.get().busy !== null) return;
    patch({ busy: 'sending', problem: null });
    const result =
      action.kind === 'send'
        ? await api.send(threadId, action.text, action.attachmentIds, sessionChoice)
        : await api.continueTurn(threadId, action.failedMessageId, sessionChoice);
    if (result.kind === 'ok') {
      const { draft } = screen.get();
      patch({ busy: null, draft: action.kind === 'send' && draft.trim() === action.text ? '' : draft });
      if (action.kind === 'send') attachments.sent(action.attachmentIds);
      return;
    }
    patch({ busy: null, problem: problemOf(result.error, action, sessionChoice) });
    if (result.error.kind === 'conflict') await load();
  }

  /** A send of the draft and the uploaded files as they are now, so an edit is never lost; undefined when there is nothing to send yet. */
  function draftAction(): PendingAction | undefined {
    const text = screen.get().draft.trim();
    const attachmentIds = attachments.readyIds();
    if (attachmentIds === null || (text === '' && attachmentIds.length === 0)) return undefined;
    return { kind: 'send', text, attachmentIds };
  }

  /** The refused action, with a send taking the draft as it is now. */
  function pendingAction(action: PendingAction): PendingAction | undefined {
    return action.kind === 'continue' ? action : draftAction();
  }

  /** Runs one queue action; a refusal (it was delivered or changed meanwhile) shows the host's reason and reloads. */
  async function onQueued(queuedId: string, act: () => Promise<ApiResult<null>>): Promise<boolean> {
    if (screen.get().queueActing.includes(queuedId)) return false;
    patch({ queueActing: [...screen.get().queueActing, queuedId], problem: null });
    const result = await act();
    patch({ queueActing: screen.get().queueActing.filter((id) => id !== queuedId) });
    if (result.kind === 'ok') return true;
    patch({ problem: { kind: 'error', message: result.error.message } });
    await load();
    return false;
  }

  function queuedItem(queuedId: string) {
    const { view } = screen.get();
    return view.kind === 'loaded' ? view.value.queue.find(({ id }) => id === queuedId) : undefined;
  }

  function problemAction(): PendingAction | undefined {
    const { problem } = screen.get();
    return problem === null || problem.kind === 'error' ? undefined : pendingAction(problem.action);
  }

  return {
    threadId,
    screen,
    attachments,
    image,
    load,
    handle,
    setStream: (up) => {
      streamUp = up;
      if (up) void load();
      else patch({ connection: 'reconnecting' });
    },
    setDraft: (draft) => {
      patch({ draft });
    },
    send: async () => {
      const action = draftAction();
      if (action !== undefined) await run(action, { kind: 'auto' });
    },
    choose: async (choice) => {
      const action = problemAction();
      if (action !== undefined) await run(action, choice);
    },
    retry: async () => {
      const { problem } = screen.get();
      const action = problemAction();
      if (action !== undefined && problem?.kind === 'retry') await run(action, problem.sessionChoice);
    },
    dismissProblem: () => {
      patch({ problem: null });
    },
    continueTurn: (failedMessageId, choice) => run({ kind: 'continue', failedMessageId }, choice),
    stop: async () => {
      if (screen.get().busy !== null) return;
      patch({ busy: 'stopping', problem: null });
      const result = await api.stop(threadId);
      patch({ busy: null, problem: result.kind === 'ok' ? null : { kind: 'error', message: result.error.message } });
      await load();
      options.onGroupsChanged?.();
    },
    answer: async (approvalId, choiceId) => {
      const current = screen.get().view;
      const generationId = current.kind === 'loaded' ? current.value.activeTurn?.generationId : undefined;
      if (generationId === undefined || screen.get().answering.includes(approvalId)) return;
      patch({ answering: [...screen.get().answering, approvalId] });
      const result = await api.answerApproval(threadId, approvalId, generationId, choiceId);
      if (result.kind === 'ok') return;
      patch({ answering: screen.get().answering.filter((id) => id !== approvalId) });
      if (result.status === 404) {
        const view = screen.get().view;
        if (shownEnded(view, approvalId)) return;
        if (view.kind === 'loaded') patch({ view: { kind: 'loaded', value: endApproval(view.value, approvalId, { kind: 'late' }) } });
        await load();
      }
      else patch({ problem: { kind: 'error', message: result.error.message } });
    },
    react: async (messageId, emoji) => {
      const current = screen.get().view;
      if (current.kind !== 'loaded') return;
      const reacted = !userReacted(current.value.reactions.filter((reaction) => reaction.messageId === messageId), emoji);
      const result = await api.setReaction(threadId, { messageId, emoji, reacted });
      if (result.kind === 'failed') patch({ problem: { kind: 'error', message: result.error.message } });
    },
    actOnCard: async (cardId, action) => {
      if (screen.get().cardActing.includes(cardId)) return false;
      patch({ cardActing: [...screen.get().cardActing, cardId], problem: null });
      const result = await api.actOnCard(threadId, cardId, action);
      patch({ cardActing: screen.get().cardActing.filter((id) => id !== cardId) });
      if (result.kind === 'failed') {
        patch({ problem: { kind: 'error', message: result.error.message } });
        return false;
      }
      const current = screen.get().view;
      if (current.kind === 'loaded') patch({ view: { kind: 'loaded', value: { ...current.value, cards: withCard(current.value.cards, result.value) } } });
      return true;
    },
    steer: async (queuedId) => {
      await onQueued(queuedId, () => api.steerQueued(threadId, queuedId));
    },
    editQueued: async (queuedId) => {
      const item = queuedItem(queuedId);
      if (item === undefined) return;
      if (item.attachments.length > 0) {
        const current = attachments.items.get();
        const existingIds = new Set(current.flatMap((each) => (each.kind === 'ready' ? [each.attachment.id] : [])));
        const taken = current.filter((each) => each.kind !== 'failed').length;
        const added = item.attachments.filter((each) => !existingIds.has(each.id)).length;
        if (taken + added > MAX_ATTACHMENTS) {
          patch({ problem: { kind: 'error', message: `Remove a file from the message box before editing (up to ${String(MAX_ATTACHMENTS)} files).` } });
          return;
        }
      }
      if (!(await onQueued(queuedId, () => api.cancelQueued(threadId, queuedId)))) return;
      if (item.text.trim() !== '') {
        const typed = screen.get().draft.trim();
        patch({ draft: typed === '' ? item.text : `${item.text}\n\n${typed}` });
      }
      if (item.attachments.length > 0) attachments.restore(item.attachments, image);
    },
    cancelQueued: async (queuedId) => {
      await onQueued(queuedId, () => api.cancelQueued(threadId, queuedId));
    },
    release: async (regId) => {
      const result = await api.releaseGroup(regId);
      if (result.kind === 'failed') patch({ problem: { kind: 'error', message: result.error.message } });
      await load();
      options.onGroupsChanged?.();
    },
    close: () => {
      closed = true;
      clearTimeout(blockedTimer);
      bridge.unsubscribe(threadId);
    },
  };
}
