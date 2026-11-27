import type { ApiError, AssistantMessage, EventServerFrame, SessionChoice, SessionChoiceReason } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store, type Loadable } from '../../shared/store.ts';
import { applyEvent, viewOf, type ThreadView } from './thread-model.ts';

/** Something the composer asked the host to start. Kept so it can be retried exactly. */
export type PendingAction =
  | { readonly kind: 'send'; readonly text: string }
  | { readonly kind: 'continue'; readonly failedMessageId: string };

export interface SessionChoiceOption {
  readonly choice: SessionChoice;
  readonly label: string;
  readonly warning: string | null;
}

/** Why the last send or Continue did not start. In every case the host wrote nothing, so the draft stays. */
export type ComposerProblem =
  | {
      readonly kind: 'session-choice';
      readonly reason: SessionChoiceReason;
      readonly prompt: string;
      readonly options: readonly SessionChoiceOption[];
      readonly action: PendingAction;
    }
  | { readonly kind: 'retry'; readonly message: string; readonly action: PendingAction }
  | { readonly kind: 'error'; readonly message: string };

export interface ThreadScreen {
  readonly view: Loadable<ThreadView>;
  readonly draft: string;
  readonly busy: 'sending' | 'stopping' | null;
  readonly problem: ComposerProblem | null;
  /** Approval ids whose answer is on its way to the host. */
  readonly answering: readonly string[];
}

export interface ThreadSession {
  readonly threadId: string;
  readonly screen: Store<ThreadScreen>;
  /** Fetches `/state`, replaces the view, and follows events from its cursor. */
  load(): Promise<void>;
  /** A frame from the host's event stream. */
  handle(frame: EventServerFrame): void;
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
}

const SEEDED: SessionChoiceOption = { choice: { kind: 'new-seeded' }, label: 'Start new seeded session', warning: null };

function sessionChoice(reason: SessionChoiceReason): Pick<Extract<ComposerProblem, { kind: 'session-choice' }>, 'prompt' | 'options'> {
  switch (reason) {
    case 'diverged':
      return {
        prompt: "The provider's saved session did not finish its last turn.",
        options: [
          { choice: { kind: 'continue-existing' }, label: 'Continue saved session', warning: 'Continuing may repeat actions the provider already took.' },
          SEEDED,
        ],
      };
    case 'instructions-changed':
      return { prompt: 'Instructions changed: start a new seeded session?', options: [SEEDED] };
    case 'unseeded-history':
      return { prompt: 'This chat has messages the provider has not seen: start a new seeded session?', options: [SEEDED] };
  }
}

export function problemOf(error: ApiError['error'], action: PendingAction): ComposerProblem {
  switch (error.kind) {
    case 'session-choice-required':
      return { kind: 'session-choice', reason: error.reason, action, ...sessionChoice(error.reason) };
    case 'provider-unavailable':
    case 'binding-changed':
      return { kind: 'retry', message: error.message, action };
    case 'invalid_request':
    case 'not_found':
    case 'conflict':
    case 'forbidden':
    case 'unauthorized':
    case 'internal':
      return { kind: 'error', message: error.message };
  }
}

export function openThreadSession(options: ThreadSessionOptions): ThreadSession {
  const { api, bridge, threadId } = options;
  const screen = new Store<ThreadScreen>({ view: { kind: 'loading' }, draft: '', busy: null, problem: null, answering: [] });
  const patch = (change: Partial<ThreadScreen>): void => {
    screen.update((current) => ({ ...current, ...change }));
  };
  let loads = 0;
  let loading = false;
  let closed = false;
  let blockedTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const mine = ++loads;
    loading = true;
    clearTimeout(blockedTimer);
    bridge.unsubscribe(threadId);
    const result = await api.threadState(threadId);
    if (mine !== loads || closed) return;
    loading = false;
    if (result.kind === 'failed') {
      patch({ view: { kind: 'failed', message: result.status === 404 ? 'This chat no longer exists.' : result.error.message } });
      return;
    }
    const view = viewOf(result.value);
    patch({ view: { kind: 'loaded', value: view } });
    bridge.subscribe(threadId, result.value.cursor);
    if (view.blockedGroups.some(({ releasable }) => !releasable)) {
      blockedTimer = setTimeout(() => void load(), options.blockedRefreshMs ?? 5_000);
    }
  }

  function handle(frame: EventServerFrame): void {
    if (closed || frame.kind === 'usage.updated' || frame.threadId !== threadId) return;
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
        if (frame.kind === 'generation.finished') {
          options.onFinished?.(frame.message);
          if (frame.message.outcome.kind === 'interrupted') void load();
        }
        return;
    }
  }

  async function run(action: PendingAction, sessionChoice: SessionChoice): Promise<void> {
    if (screen.get().busy !== null) return;
    patch({ busy: 'sending', problem: null });
    const result =
      action.kind === 'send'
        ? await api.send(threadId, action.text, sessionChoice)
        : await api.continueTurn(threadId, action.failedMessageId, sessionChoice);
    if (result.kind === 'ok') {
      const { draft } = screen.get();
      patch({ busy: null, draft: action.kind === 'send' && draft.trim() === action.text ? '' : draft });
      return;
    }
    patch({ busy: null, problem: problemOf(result.error, action) });
  }

  function pendingAction(): PendingAction | undefined {
    const { problem } = screen.get();
    return problem === null || problem.kind === 'error' ? undefined : problem.action;
  }

  return {
    threadId,
    screen,
    load,
    handle,
    setDraft: (draft) => {
      patch({ draft });
    },
    send: async () => {
      const text = screen.get().draft.trim();
      if (text === '') return;
      await run({ kind: 'send', text }, { kind: 'auto' });
    },
    choose: async (choice) => {
      const action = pendingAction();
      if (action !== undefined) await run(action, choice);
    },
    retry: async () => {
      const action = pendingAction();
      if (action !== undefined) await run(action, { kind: 'auto' });
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
    },
    answer: async (approvalId, choiceId) => {
      const current = screen.get().view;
      const generationId = current.kind === 'loaded' ? current.value.activeTurn?.generationId : undefined;
      if (generationId === undefined || screen.get().answering.includes(approvalId)) return;
      patch({ answering: [...screen.get().answering, approvalId] });
      const result = await api.answerApproval(threadId, approvalId, generationId, choiceId);
      patch({ answering: screen.get().answering.filter((id) => id !== approvalId) });
      if (result.kind === 'ok') return;
      if (result.status === 404) await load();
      else patch({ problem: { kind: 'error', message: result.error.message } });
    },
    release: async (regId) => {
      const result = await api.releaseGroup(regId);
      if (result.kind === 'failed') patch({ problem: { kind: 'error', message: result.error.message } });
      await load();
    },
    close: () => {
      closed = true;
      clearTimeout(blockedTimer);
      bridge.unsubscribe(threadId);
    },
  };
}
