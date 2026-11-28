import type {
  ActiveTurn,
  AssistantMessage,
  CreateThreadRequest,
  Cursor,
  Message,
  QueuedMessage,
  SessionChoice,
  StopGenerationResponse,
  Thread,
  ThreadState,
} from '@morrowbot/contracts';
import { admit, type AdmitResult } from './admission.ts';
import { dispatch } from './dispatch.ts';
import { EventLog, type Replay } from './event-log.ts';
import type { ChatListener, ChatServiceOptions, RecheckAnswer } from './ports.ts';
import { afterTurn, cancelQueued, enqueue, queueOf, sendsQueue, steerQueued, type QueueAnswer } from './queue.ts';
import { laneOf, localSettlement, queueNote, settle, type ChatCore, type StoredReply, type Turn } from './turn.ts';
import { readUsage, type UsageAnswer } from './usage.ts';

export type ApprovalResult = { readonly kind: 'replied' } | { readonly kind: 'not_found' };

/** Stop's answer; `not_stored` when the reply could not be saved (the thread stays busy until restart). */
export type StopResult = StopGenerationResponse | { readonly kind: 'not_stored' };

export type RecheckResult = RecheckAnswer;

/** A send starts a turn, or waits in the thread's queue while a turn runs. */
export type SendResult = AdmitResult | { readonly kind: 'queued'; readonly queued: QueuedMessage };

export interface ChatService {
  listThreads(agentId: string): Thread[] | undefined;
  /** Every agent's threads, most recently changed first (for ⌘K). */
  listAllThreads(): Thread[];
  createThread(agentId: string, request: CreateThreadRequest): Thread | undefined;
  getThread(id: string): Thread | undefined;
  renameThread(id: string, title: string): Thread | undefined;
  /** Stops the thread's turn, then deletes the thread. No new turn can start meanwhile. */
  deleteThread(id: string): Promise<boolean>;
  /** Stops every turn of the agent, then deletes the agent and its threads. */
  deleteAgent(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  /** The thread, its messages, its live turn and blocked groups, and its cursor, as one snapshot. */
  state(threadId: string): ThreadState | undefined;
  send(threadId: string, text: string, choice: SessionChoice): Promise<SendResult>;
  /** Takes a message the agent has not seen out of the queue. */
  cancelQueued(threadId: string, queuedId: string): QueueAnswer;
  /** Delivers a queued message now: into the running reply, or as the next turn when nothing runs. */
  steerQueued(threadId: string, queuedId: string): QueueAnswer;
  continueTurn(threadId: string, failedMessageId: string, choice: SessionChoice): Promise<AdmitResult>;
  /** Stops the thread's turn and resolves once its reply is stored and its processes are gone. */
  stop(threadId: string): Promise<StopResult>;
  replyApproval(threadId: string, generationId: string, approvalId: string, choiceId: string): ApprovalResult;
  /**
   * Recheck: refused while the plugin has a queued or running turn. Closes admission (a send gets
   * `rechecking`), retires the plugin's daemon, starts a fresh one and reopens admission however that ends.
   */
  recheck(pluginId: string): Promise<RecheckResult>;
  usage(pluginId: string, refresh: boolean): Promise<UsageAnswer>;
  /** The events a client missed since `since`, or `resync`. Synchronous with `subscribe`. */
  replay(threadId: string, since: Cursor): Replay;
  subscribe(listener: ChatListener): () => void;
  close(): Promise<void>;
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const { store, agents } = options;
  const core: ChatCore = {
    options,
    events: new EventLog(options.hostEpoch),
    active: new Map(),
    lanes: new Map(),
    fenced: new Set(),
    rechecking: new Set(),
    liveUsage: new Map(),
    deletingThreads: new Set(),
    deletingAgents: new Set(),
    queueStates: new Map(),
    draining: new Map(),
    dispatch: (turn) => dispatch(core, turn),
    afterTurn: (turn, outcome) => {
      afterTurn(core, turn, outcome);
    },
    closed: false,
  };
  recover(options);

  /** Stops a turn the way its state allows. Resolves once cleanup is over (see `Turn.quiet`), with its reply. */
  const stopTurn = async (turn: Turn): Promise<StoredReply> => {
    switch (turn.state) {
      case 'queued': {
        const lane = laneOf(core, turn);
        lane.queue.splice(lane.queue.indexOf(turn), 1);
        settle(core, turn, localSettlement({ kind: 'cancelled' }));
        break;
      }
      case 'dispatching':
        turn.stopRequested = true;
        break;
      case 'running':
        turn.stopRequested = true;
        options.plugins.cancelTurn(turn.pluginId, turn.generationId);
        break;
      case 'settled':
        break;
    }
    const reply = await turn.settled.promise;
    await turn.quiet.promise;
    return reply;
  };

  const stop = async (threadId: string): Promise<StopResult> => {
    const turn = core.active.get(threadId);
    if (turn === undefined) return { kind: 'idle' };
    const reply = await stopTurn(turn);
    return reply.kind === 'stored' ? { kind: 'stopped', message: reply.message } : { kind: 'not_stored' };
  };

  /** Runs `remove` with no turn running, and none able to start, in the threads it removes. */
  async function exclusively(keys: Set<string>, key: string, match: (turn: Turn) => boolean, remove: () => boolean): Promise<boolean> {
    keys.add(key);
    try {
      await Promise.all([...core.active.values()].filter(match).map((turn) => stopTurn(turn)));
      return remove();
    } finally {
      keys.delete(key);
    }
  }

  const activeTurn = (threadId: string): ActiveTurn | null => {
    const turn = core.active.get(threadId);
    if (turn === undefined || turn.state === 'settled') return null;
    return {
      generationId: turn.generationId,
      state: turn.state === 'queued' ? 'queued' : 'running',
      queueNote: turn.state === 'queued' ? queueNote(laneOf(core, turn)) : null,
      text: turn.text,
      pendingApprovals: [...turn.approvals.values()],
    };
  };

  return {
    listThreads: (agentId) => (agents.get(agentId) === undefined ? undefined : store.threads.listByAgent(agentId)),
    listAllThreads: () => store.threads.listAll(),
    createThread: (agentId, request) => {
      if (agents.get(agentId) === undefined) return undefined;
      const at = options.now();
      const thread: Thread = { id: options.newId(), agentId, title: request.title, createdAt: at, updatedAt: at };
      store.threads.insert(thread);
      return thread;
    },
    getThread: (id) => store.threads.get(id),
    renameThread: (id, title) => {
      const current = store.threads.get(id);
      if (current === undefined) return undefined;
      const next: Thread = { ...current, title, updatedAt: options.now() };
      store.threads.update(next);
      return next;
    },
    deleteThread: async (id) => {
      const removed = await exclusively(core.deletingThreads, id, (turn) => turn.threadId === id, () => store.threads.delete(id));
      if (removed) core.events.forget(id);
      return removed;
    },
    deleteAgent: (id) => exclusively(core.deletingAgents, id, (turn) => turn.agentId === id, () => agents.delete(id)),
    listMessages: (threadId) => (store.threads.get(threadId) === undefined ? undefined : store.messages.listByThread(threadId)),
    state: (threadId) => {
      const thread = store.threads.get(threadId);
      if (thread === undefined) return undefined;
      return {
        thread,
        messages: store.messages.listByThread(threadId),
        activeTurn: activeTurn(threadId),
        queue: queueOf(core, threadId),
        blockedGroups: options.plugins.blockedGroups(store.generations.idsByThread(threadId)),
        cursor: core.events.cursor(threadId),
      };
    },
    send: async (threadId, text, choice) => {
      if (!sendsQueue(core, threadId)) return admit(core, threadId, { kind: 'send', text }, choice);
      if (core.closed || core.deletingThreads.has(threadId) || store.threads.get(threadId) === undefined) return { kind: 'thread_not_found' };
      return { kind: 'queued', queued: enqueue(core, threadId, text) };
    },
    cancelQueued: (threadId, queuedId) => cancelQueued(core, threadId, queuedId),
    steerQueued: (threadId, queuedId) => steerQueued(core, threadId, queuedId),
    continueTurn: (threadId, failedMessageId, choice) => admit(core, threadId, { kind: 'continue', failedMessageId }, choice),
    stop,
    replyApproval: (threadId, generationId, approvalId, choiceId) => {
      const turn = core.active.get(threadId);
      if (turn?.generationId !== generationId || turn.state !== 'running') return { kind: 'not_found' };
      const approval = turn.approvals.get(approvalId);
      if (approval?.choices.some((choice) => choice.id === choiceId) !== true) return { kind: 'not_found' };
      turn.approvals.delete(approvalId);
      options.plugins.replyApproval(turn.pluginId, generationId, approvalId, choiceId);
      core.events.publish({ kind: 'generation.approval-resolved', threadId, generationId, approvalId, resolution: { kind: 'chosen', choiceId } });
      return { kind: 'replied' };
    },
    recheck: async (pluginId) => {
      if (core.rechecking.has(pluginId)) return { kind: 'unavailable', reason: 'This provider is already being rechecked.' };
      if ([...core.active.values()].some((turn) => turn.pluginId === pluginId && turn.state !== 'settled')) return { kind: 'busy' };
      core.rechecking.add(pluginId);
      try {
        const result = await options.plugins.recheck(pluginId);
        if (result.kind !== 'blocked' && result.kind !== 'busy') core.liveUsage.delete(pluginId);
        return result;
      } finally {
        core.rechecking.delete(pluginId);
      }
    },
    usage: (pluginId, refresh) => readUsage(core, pluginId, refresh),
    replay: (threadId, since) => core.events.replay(threadId, since),
    subscribe: (listener) => core.events.subscribe(listener),
    close: async () => {
      core.closed = true;
      await Promise.all([...core.active.values()].map((turn) => stopTurn(turn)));
    },
  };
}

/** Turns a crash left unsettled end as interrupted, keeping the text saved so far. */
function recover(options: ChatServiceOptions): void {
  const { store } = options;
  for (const generation of store.generations.unsettled()) {
    const at = options.now();
    const message: AssistantMessage = {
      kind: 'assistant',
      id: options.newId(),
      threadId: generation.threadId,
      text: generation.partialText,
      outcome: { kind: 'interrupted' },
      createdAt: at,
    };
    store.transaction(() => {
      store.messages.insert(message);
      store.threads.touch(generation.threadId, at);
      store.generations.settle(generation.id, message.id);
    });
  }
}
