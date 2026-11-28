import type { ApiError } from '@morrowbot/contracts';
import type { ChatHost } from '../../lib/chat-host.ts';
import type { ThreadEvent } from '../../lib/host-connection.ts';
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
  /** The link dropped or is catching up: the view is the last one seen, and every action waits for the next `/state`. */
  readonly stale: boolean;
}

/** The composer's one main button. */
export type ComposerButton =
  | { readonly kind: 'send'; readonly enabled: boolean }
  | { readonly kind: 'stop'; readonly enabled: boolean };

/** Send while the thread is idle, Stop while a turn is queued or running; neither while stale. */
export function composerButton(screen: ChatScreen): ComposerButton {
  if (screen.view.kind !== 'loaded') return { kind: 'send', enabled: false };
  const ready = screen.busy === null && !screen.stale;
  if (screen.view.value.activeTurn !== null || screen.busy === 'stopping') return { kind: 'stop', enabled: ready };
  return { kind: 'send', enabled: ready && screen.draft.trim() !== '' };
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
  /** Watches the thread again from a fresh `/state`, replacing the view when it arrives. */
  load(): void;
  setDraft(text: string): void;
  send(): Promise<void>;
  /** Runs the failed or interrupted latest turn again. */
  continueTurn(failedMessageId: string): Promise<void>;
  /** Runs the refused action again: a Continue as it was, a send with the draft as it is now. */
  retry(): Promise<void>;
  stop(): Promise<void>;
  answer(approvalId: string, choiceId: string): Promise<void>;
  close(): void;
}

export function openChatSession(host: ChatHost, threadId: string): ChatSession {
  const screen = new Store<ChatScreen>({ view: { kind: 'loading' }, draft: '', busy: null, answering: [], problem: null, stale: false });
  const patch = (change: Partial<ChatScreen>): void => {
    screen.update((current) => {
      const next = { ...current, ...change };
      return change.view === undefined ? next : { ...next, answering: next.answering.filter((id) => stillPending(next.view, id)) };
    });
  };
  let closed = false;
  let unwatch: () => void = () => undefined;

  function load(): void {
    unwatch();
    if (closed) return;
    let mine = true;
    const stop = host.watch(threadId, {
      onFresh: (state) => {
        if (!mine) return;
        const before = screen.get().view;
        patch({ view: { kind: 'loaded', value: viewOf(state, before.kind === 'loaded' ? before.value : null) }, stale: false });
      },
      onEvent: (event) => {
        if (mine) handle(event);
      },
      onStale: () => {
        if (mine) patch({ stale: true });
      },
      onGone: () => {
        if (mine) patch({ view: { kind: 'failed', message: 'This chat no longer exists.' }, stale: false });
      },
    });
    unwatch = () => {
      mine = false;
      stop();
    };
  }

  function handle(event: ThreadEvent): void {
    const current = screen.get().view;
    if (current.kind !== 'loaded') return;
    const applied = applyEvent(current.value, event);
    switch (applied.kind) {
      case 'ignored':
        return;
      case 'resync':
        load();
        return;
      case 'applied':
        patch({ view: { kind: 'loaded', value: applied.view } });
    }
  }

  const idle = (): boolean => screen.get().busy === null && !screen.get().stale;

  async function run(action: PendingAction): Promise<void> {
    if (!idle()) return;
    patch({ busy: 'sending', problem: null });
    const result =
      action.kind === 'send' ? await host.send(threadId, action.text) : await host.continueTurn(threadId, action.failedMessageId);
    if (result.kind === 'ok') {
      const { draft } = screen.get();
      patch({ busy: null, draft: action.kind === 'send' && draft.trim() === action.text ? '' : draft });
      return;
    }
    patch({ busy: null, problem: problemOf(result.error, action) });
    if (result.error.kind === 'conflict') load();
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
      if (problem.action.kind === 'continue') {
        await run(problem.action);
        return;
      }
      const text = screen.get().draft.trim();
      if (text === '') patch({ problem: null });
      else await run({ kind: 'send', text });
    },
    stop: async () => {
      if (!idle()) return;
      patch({ busy: 'stopping', problem: null });
      const result = await host.stop(threadId);
      patch({ busy: null, problem: result.kind === 'ok' ? null : { kind: 'error', message: result.error.message } });
      load();
    },
    answer: async (approvalId, choiceId) => {
      const current = screen.get().view;
      const generationId = current.kind === 'loaded' ? current.value.activeTurn?.generationId : undefined;
      if (generationId === undefined || screen.get().stale || screen.get().answering.includes(approvalId) || !stillPending(current, approvalId)) return;
      patch({ answering: [...screen.get().answering, approvalId] });
      const result = await host.answerApproval(threadId, approvalId, { generationId, choiceId });
      if (result.kind === 'ok') return;
      patch({ answering: screen.get().answering.filter((id) => id !== approvalId) });
      if (result.status === 404) {
        const view = screen.get().view;
        if (view.kind === 'loaded') patch({ view: { kind: 'loaded', value: endApproval(view.value, approvalId, { kind: 'late' }) } });
        load();
        return;
      }
      patch({ problem: { kind: 'error', message: result.error.message } });
    },
    close: () => {
      closed = true;
      unwatch();
    },
  };
}
