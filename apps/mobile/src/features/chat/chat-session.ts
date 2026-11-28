import type { ApiError, EventServerFrame } from '@morrowbot/contracts';
import type { ChatHost } from './chat-host.ts';
import { Store, type Loadable } from './store.ts';
import { applyEvent, endApproval, pendingApprovals, viewOf, type ThreadView } from './thread-view.ts';

/** What the composer asked the host to start, kept so Retry runs it again exactly. */
export type PendingAction =
  | { readonly kind: 'send'; readonly text: string }
  | { readonly kind: 'continue'; readonly failedMessageId: string };

/** Why the last send, Continue or Stop did not go through. The host wrote nothing, so the draft stays. */
export type ComposerProblem =
  | { readonly kind: 'retry'; readonly message: string; readonly action: PendingAction }
  | { readonly kind: 'error'; readonly message: string };

export interface ChatScreen {
  readonly view: Loadable<ThreadView>;
  readonly draft: string;
  readonly busy: 'sending' | 'stopping' | null;
  /** Approval ids whose answer is on its way to the host. */
  readonly answering: readonly string[];
  readonly problem: ComposerProblem | null;
}

/** The composer's one main button. */
export type ComposerButton =
  | { readonly kind: 'send'; readonly enabled: boolean }
  | { readonly kind: 'stop'; readonly enabled: boolean };

/** Send while the thread is idle, Stop while a turn is queued or running. */
export function composerButton(screen: ChatScreen): ComposerButton {
  if (screen.view.kind !== 'loaded') return { kind: 'send', enabled: false };
  if (screen.view.value.activeTurn !== null || screen.busy === 'stopping') return { kind: 'stop', enabled: screen.busy === null };
  return { kind: 'send', enabled: screen.busy === null && screen.draft.trim() !== '' };
}

function problemOf(error: ApiError['error'], action: PendingAction): ComposerProblem {
  switch (error.kind) {
    case 'provider-unavailable':
    case 'binding-changed':
      return { kind: 'retry', message: error.message, action };
    case 'session-choice-required':
      return { kind: 'error', message: 'This chat needs a choice on your computer before it can continue.' };
    case 'invalid_request':
    case 'not_found':
    case 'conflict':
    case 'forbidden':
    case 'unauthorized':
    case 'internal':
    case 'instructions-conflict':
      return { kind: 'error', message: error.message };
  }
}

const stillPending = (view: ChatScreen['view'], approvalId: string): boolean =>
  view.kind === 'loaded' && pendingApprovals(view.value.activeTurn).some((approval) => approval.approvalId === approvalId);

export interface ChatSession {
  readonly threadId: string;
  readonly screen: Store<ChatScreen>;
  /** Fetches `/state`, replaces the view, and follows events from its cursor. */
  load(): Promise<void>;
  setDraft(text: string): void;
  send(): Promise<void>;
  /** Runs the failed or interrupted latest turn again. */
  continueTurn(failedMessageId: string): Promise<void>;
  /** Runs the refused action again as it was. */
  retry(): Promise<void>;
  stop(): Promise<void>;
  answer(approvalId: string, choiceId: string): Promise<void>;
  close(): void;
}

export function openChatSession(host: ChatHost, threadId: string): ChatSession {
  const screen = new Store<ChatScreen>({ view: { kind: 'loading' }, draft: '', busy: null, answering: [], problem: null });
  const patch = (change: Partial<ChatScreen>): void => {
    screen.update((current) => {
      const next = { ...current, ...change };
      return change.view === undefined ? next : { ...next, answering: next.answering.filter((id) => stillPending(next.view, id)) };
    });
  };
  let loads = 0;
  let loading = false;
  let closed = false;
  let unfollow: () => void = () => undefined;

  async function load(): Promise<void> {
    const mine = ++loads;
    loading = true;
    unfollow();
    const result = await host.threadState(threadId);
    if (mine !== loads || closed) return;
    loading = false;
    if (result.kind === 'failed') {
      patch({ view: { kind: 'failed', message: result.status === 404 ? 'This chat no longer exists.' : result.error.message } });
      return;
    }
    const before = screen.get().view;
    patch({ view: { kind: 'loaded', value: viewOf(result.value, before.kind === 'loaded' ? before.value : null) } });
    unfollow = host.follow(threadId, result.value.cursor, handle);
  }

  function handle(frame: EventServerFrame): void {
    if (closed || frame.kind === 'usage.updated' || frame.kind === 'agent-message.posted' || frame.threadId !== threadId) return;
    if (frame.kind === 'resync') {
      void load();
      return;
    }
    const current = screen.get().view;
    if (loading || current.kind !== 'loaded') return;
    const applied = applyEvent(current.value, frame);
    switch (applied.kind) {
      case 'ignored':
        return;
      case 'resync':
        void load();
        return;
      case 'applied':
        patch({ view: { kind: 'loaded', value: applied.view } });
    }
  }

  async function run(action: PendingAction): Promise<void> {
    if (screen.get().busy !== null) return;
    patch({ busy: 'sending', problem: null });
    const result =
      action.kind === 'send' ? await host.send(threadId, action.text) : await host.continueTurn(threadId, action.failedMessageId);
    if (result.kind === 'ok') {
      const { draft } = screen.get();
      patch({ busy: null, draft: action.kind === 'send' && draft.trim() === action.text ? '' : draft });
      return;
    }
    patch({ busy: null, problem: problemOf(result.error, action) });
    if (result.error.kind === 'conflict') await load();
  }

  return {
    threadId,
    screen,
    load,
    setDraft: (draft) => {
      patch({ draft });
    },
    send: async () => {
      const text = screen.get().draft.trim();
      if (text !== '') await run({ kind: 'send', text });
    },
    continueTurn: (failedMessageId) => run({ kind: 'continue', failedMessageId }),
    retry: async () => {
      const { problem } = screen.get();
      if (problem?.kind !== 'retry') return;
      await run(problem.action.kind === 'send' ? { kind: 'send', text: screen.get().draft.trim() || problem.action.text } : problem.action);
    },
    stop: async () => {
      if (screen.get().busy !== null) return;
      patch({ busy: 'stopping', problem: null });
      const result = await host.stop(threadId);
      patch({ busy: null, problem: result.kind === 'ok' ? null : { kind: 'error', message: result.error.message } });
      await load();
    },
    answer: async (approvalId, choiceId) => {
      const current = screen.get().view;
      const generationId = current.kind === 'loaded' ? current.value.activeTurn?.generationId : undefined;
      if (generationId === undefined || screen.get().answering.includes(approvalId) || !stillPending(current, approvalId)) return;
      patch({ answering: [...screen.get().answering, approvalId] });
      const result = await host.answerApproval(threadId, approvalId, { generationId, choiceId });
      if (result.kind === 'ok') return;
      patch({ answering: screen.get().answering.filter((id) => id !== approvalId) });
      if (result.status === 404) {
        const view = screen.get().view;
        if (view.kind === 'loaded') patch({ view: { kind: 'loaded', value: endApproval(view.value, approvalId, { kind: 'late' }) } });
        await load();
        return;
      }
      patch({ problem: { kind: 'error', message: result.error.message } });
    },
    close: () => {
      closed = true;
      unfollow();
    },
  };
}
