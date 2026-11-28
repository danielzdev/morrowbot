import type {
  ActiveTurn,
  CreateThreadRequest,
  Cursor,
  Message,
  QueuedMessage,
  SessionChoice,
  SetReactionRequest,
  StopGenerationResponse,
  SubagentRun,
  Thread,
  ThreadState,
  ThreadSummary,
} from '@morrowbot/contracts';
import { admit, type AdmitResult } from './admission.ts';
import { backgroundPrompt } from './background.ts';
import { parentTurn, publishSubagent, stopChildren, stopTurn as stopWithChildren, subagentsOf, subagentView, type ParentTurn } from './children.ts';
import { dispatch } from './dispatch.ts';
import { EventLog, type Replay } from './event-log.ts';
import type { ChatListener, ChatServiceOptions, RecheckAnswer, ThreadArchiveFilter } from './ports.ts';
import { agentReact, dropNote, emojiReplies, nextNote, reactionPrompt, readOrGone, setUserReaction, stayQuiet, type ReplyToolAnswer, type SetReactionAnswer, type TurnGrant } from './reactions.ts';
import { recover } from './recover.ts';
import { createSummaryFeed, type SummaryListener } from './thread-summary.ts';
import { afterTurn, cancelQueued, enqueue, queueOf, sendsQueue, steerQueued, type QueueAnswer } from './queue.ts';
import { laneOf, queueNote, type ChatCore, type StoredReply, type Turn } from './turn.ts';
import { readUsage, type UsageAnswer } from './usage.ts';

export type ApprovalResult = { readonly kind: 'replied' } | { readonly kind: 'not_found' };

/** Stop's answer; `not_stored` when the reply could not be saved (the thread stays busy until restart). */
export type StopResult = StopGenerationResponse | { readonly kind: 'not_stored' };

export type RecheckResult = RecheckAnswer;

/** A sub-agent's turn was admitted in its chat, or why not (nothing was written). */
export type SubagentStart = { readonly kind: 'started'; readonly run: SubagentRun } | { readonly kind: 'refused'; readonly reason: string };

/** A send starts a turn, or waits in the thread's queue while a turn runs. */
export type SendResult = AdmitResult | { readonly kind: 'queued'; readonly queued: QueuedMessage };

export type ArchiveThreadResult =
  | { readonly kind: 'archived'; readonly thread: Thread }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

export interface ChatService {
  listThreads(agentId: string, filter?: ThreadArchiveFilter): Thread[] | undefined;
  /** Every agent's active threads with what each is doing, most recently changed first. */
  listThreadSummaries(): ThreadSummary[];
  createThread(agentId: string, request: CreateThreadRequest): Thread | undefined;
  getThread(id: string): Thread | undefined;
  renameThread(id: string, title: string): Thread | undefined;
  archiveThread(id: string): ArchiveThreadResult;
  restoreThread(id: string): Thread | undefined;
  /** Stops the thread's turn, then deletes the thread. No new turn can start meanwhile. */
  deleteThread(id: string): Promise<boolean>;
  /** Stops every turn of the agent, then deletes the agent and its threads. */
  deleteAgent(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  /** The thread, its messages, its live turn and blocked groups, and its cursor, as one snapshot. */
  state(threadId: string): ThreadState | undefined;
  /** The user's send: while a turn runs it waits in the queue. */
  send(threadId: string, text: string, attachmentIds: readonly string[], choice: SessionChoice): Promise<SendResult>;
  /** A routine's send: never queued (refused as busy), and its turn denies instead of asking for approval. */
  sendUnattended(threadId: string, text: string, choice: SessionChoice): Promise<AdmitResult>;
  /** Takes a message the agent has not seen out of the queue. */
  cancelQueued(threadId: string, queuedId: string): QueueAnswer;
  /**
   * Puts the user's emoji on one of the agent's replies, or takes it off. A new one also reaches the agent, in a turn
   * of its own once the chat is idle, where it may act on it or end quietly.
   */
  setReaction(threadId: string, request: SetReactionRequest): SetReactionAnswer;
  /** `react_to_message` for a running turn: its agent reacts to the user's message. */
  agentReact(grant: TurnGrant, emoji: string): ReplyToolAnswer;
  /** `stay_quiet` for a running turn: it ends with no message, if the agent may answer that way. */
  stayQuiet(grant: TurnGrant): ReplyToolAnswer;
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
  /**
   * Starts a background turn on the oldest message from another agent that no turn has read, in `threadId`
   * (every chat when null) once that chat is idle. Each chat reads its next message whenever it goes idle.
   */
  readAgentMessages(threadId: string | null): void;
  /** Runs a sub-agent's prompt in its chat (made with its record), while the turn that started it runs. */
  startSubagent(threadId: string, text: string): Promise<SubagentStart>;
  /** The running turn `generationId`, which sub-agents inherit from; undefined once it settles or is stopping. */
  parentTurn(generationId: string): ParentTurn | undefined;
  /** One sub-agent as its parent chat shows it. */
  subagent(threadId: string): SubagentRun | undefined;
  /** The sub-agents a chat's turns started, oldest first. */
  subagents(parentThreadId: string): SubagentRun[];
  /** Whether any turn of the agent (in any of its chats, routine runs included) is queued or running. */
  agentBusy(agentId: string): boolean;
  /** The events a client missed since `since`, or `resync`. Synchronous with `subscribe`. */
  replay(threadId: string, since: Cursor): Replay;
  subscribe(listener: ChatListener): () => void;
  /** Each time a thread is created or renamed, gets a message, or changes activity, with its new summary. */
  watchThreads(listener: SummaryListener): () => void;
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
    reactionNotes: new Map(),
    dispatch: (turn) => dispatch(core, turn),
    afterTurn: (turn, outcome) => {
      afterTurn(core, turn, outcome);
      readNext(turn.threadId);
    },
    readNext: (threadId) => {
      readNext(threadId);
    },
    endChildren: (turn) => {
      stopChildren(core, turn).catch(options.report);
    },
    subagentChanged: (turn) => {
      publishSubagent(core, turn);
    },
    closed: false,
  };

  /**
   * Admits a background turn on the thread's oldest unread agent message; one that cannot start yet keeps
   * waiting, as it does while the user's queued message is being sent.
   */
  function readNext(threadId: string): void {
    if (core.closed || core.active.has(threadId) || core.draining.has(threadId)) return;
    if (store.threads.get(threadId)?.archivedAt !== null) return;
    const [message] = options.inbox.waiting(threadId);
    if (message !== undefined) {
      const sender = agents.get(message.from.agentId)?.name ?? 'another agent';
      admit(core, threadId, { kind: 'agent-message', message, prompt: backgroundPrompt(message, sender) }, { kind: 'auto' }).catch(options.report);
      return;
    }
    readReaction(threadId);
  }

  /** Starts a turn on the user's oldest unread reaction. One that finds the chat busy waits for the next idle moment. */
  function readReaction(threadId: string): void {
    const note = nextNote(core, threadId);
    if (note === undefined) return;
    const message = store.messages.get(note.messageId);
    const thread = store.threads.get(threadId);
    if (message?.kind !== 'assistant' || thread === undefined) {
      dropNote(core, threadId, note);
      return;
    }
    const prompt = reactionPrompt(message, note.emoji, emojiReplies(core, thread.agentId));
    admit(core, threadId, { kind: 'reaction', message, emoji: note.emoji, prompt }, { kind: 'auto' }).then((result) => {
      if (readOrGone(result)) dropNote(core, threadId, note);
    }, options.report);
  }
  recover(options);
  const summaries = createSummaryFeed(core);

  const stopTurn = (turn: Turn): Promise<StoredReply> => stopWithChildren(core, turn);

  const stop = async (threadId: string): Promise<StopResult> => {
    const turn = core.active.get(threadId);
    if (turn === undefined) return { kind: 'idle' };
    const reply = await stopTurn(turn);
    switch (reply.kind) {
      case 'stored':
        return { kind: 'stopped', message: reply.message };
      case 'quiet':
        return { kind: 'stopped-in-background' };
      case 'not-stored':
        return { kind: 'not_stored' };
    }
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
      trigger: turn.source.kind === 'agent-message' ? { kind: 'agent-message', agentMessageId: turn.source.message.id } : { kind: 'chat' },
      state: turn.state === 'queued' ? 'queued' : 'running',
      queueNote: turn.state === 'queued' ? queueNote(laneOf(core, turn)) : null,
      text: turn.text,
      pendingApprovals: [...turn.approvals.values()],
      toolSteps: store.toolSteps.listOpen(turn.generationId),
    };
  };

  return {
    listThreads: (agentId, filter = 'active') => (agents.get(agentId) === undefined ? undefined : store.threads.listByAgent(agentId, filter)),
    listThreadSummaries: () => summaries.list(),
    createThread: (agentId, request) => {
      if (agents.get(agentId) === undefined) return undefined;
      const at = options.now();
      const thread = store.threads.insert({ id: options.newId(), agentId, title: request.title, createdAt: at, updatedAt: at });
      summaries.check(thread.id);
      return thread;
    },
    getThread: (id) => store.threads.get(id),
    renameThread: (id, title) => {
      const current = store.threads.get(id);
      if (current === undefined) return undefined;
      const next: Thread = { ...current, title, updatedAt: options.now() };
      store.threads.update(next);
      summaries.check(id);
      return next;
    },
    archiveThread: (id) => {
      const current = store.threads.get(id);
      if (current === undefined || core.deletingThreads.has(id) || core.deletingAgents.has(current.agentId) || store.subagents.get(id) !== undefined) {
        return { kind: 'not_found' };
      }
      if (current.archivedAt !== null) return { kind: 'archived', thread: current };
      if (core.active.has(id) || core.draining.has(id) || store.heldThreads().has(id)) {
        return { kind: 'conflict', reason: 'Stop the reply before archiving this chat.' };
      }
      const archivedAt = options.now();
      if (!store.threads.setArchived(id, archivedAt)) return { kind: 'not_found' };
      const next: Thread = { ...current, archivedAt };
      summaries.check(id);
      return { kind: 'archived', thread: next };
    },
    restoreThread: (id) => {
      const current = store.threads.get(id);
      if (current === undefined || core.deletingThreads.has(id) || core.deletingAgents.has(current.agentId) || store.subagents.get(id) !== undefined) {
        return undefined;
      }
      if (current.archivedAt === null) return current;
      if (!store.threads.setArchived(id, null)) return undefined;
      const next: Thread = { ...current, archivedAt: null };
      summaries.check(id);
      readNext(id);
      return next;
    },
    deleteThread: async (id) => {
      const removed = await exclusively(
        core.deletingThreads,
        id,
        (turn) => turn.threadId === id || turn.parent?.threadId === id,
        () => store.threads.delete(id),
      );
      if (removed) {
        core.events.forget(id);
        core.reactionNotes.delete(id);
        summaries.forget(id);
      }
      return removed;
    },
    deleteAgent: async (id) => {
      const threadIds = store.threads.listByAgent(id, 'all').map((thread) => thread.id);
      const removed = await exclusively(core.deletingAgents, id, (turn) => turn.agentId === id, () => agents.delete(id));
      if (removed) for (const threadId of threadIds) summaries.forget(threadId);
      return removed;
    },
    listMessages: (threadId) => (store.threads.get(threadId) === undefined ? undefined : store.messages.listByThread(threadId)),
    state: (threadId) => {
      const thread = store.threads.get(threadId);
      if (thread === undefined) return undefined;
      return {
        thread,
        messages: store.messages.listByThread(threadId),
        reactions: store.reactions.listByThread(threadId),
        toolSteps: store.toolSteps.listByThread(threadId),
        activeTurn: activeTurn(threadId),
        queue: queueOf(core, threadId),
        blockedGroups: options.plugins.blockedGroups(store.generations.idsByThread(threadId)),
        subagents: subagentsOf(core, threadId),
        cursor: core.events.cursor(threadId),
      };
    },
    send: async (threadId, text, attachmentIds, choice) => {
      if (!sendsQueue(core, threadId)) return admit(core, threadId, { kind: 'send', text, attachmentIds, mode: 'interactive' }, choice);
      const thread = store.threads.get(threadId);
      if (core.closed || core.deletingThreads.has(threadId) || thread === undefined) return { kind: 'thread_not_found' };
      if (thread.archivedAt !== null) return { kind: 'not_continuable', reason: 'Restore this chat before sending a message.' };
      return enqueue(core, threadId, text, attachmentIds);
    },
    sendUnattended: (threadId, text, choice) => admit(core, threadId, { kind: 'send', text, attachmentIds: [], mode: 'background' }, choice),
    setReaction: (threadId, request) => setUserReaction(core, threadId, request),
    agentReact: (grant, emoji) => agentReact(core, grant, emoji),
    stayQuiet: (grant) => stayQuiet(core, grant),
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
    readAgentMessages: (threadId) => {
      const threads = threadId === null ? new Set(options.inbox.waiting(null).map(({ to }) => to.threadId)) : [threadId];
      for (const each of threads) readNext(each);
    },
    startSubagent: async (threadId, text) => {
      const result = await admit(core, threadId, { kind: 'subagent', text }, { kind: 'auto' });
      const record = store.subagents.get(threadId);
      if (result.kind === 'started' && record !== undefined) return { kind: 'started', run: subagentView(core, record) };
      return { kind: 'refused', reason: subagentRefusal(result) };
    },
    parentTurn: (generationId) => parentTurn(core, generationId),
    subagent: (threadId) => {
      const record = store.subagents.get(threadId);
      return record === undefined ? undefined : subagentView(core, record);
    },
    subagents: (parentThreadId) => subagentsOf(core, parentThreadId),
    agentBusy: (agentId) => [...core.active.values()].some((turn) => turn.agentId === agentId && turn.state !== 'settled'),
    replay: (threadId, since) => core.events.replay(threadId, since),
    subscribe: (listener) => core.events.subscribe(listener),
    watchThreads: (listener) => summaries.subscribe(listener),
    close: async () => {
      core.closed = true;
      await Promise.all([...core.active.values()].map((turn) => stopTurn(turn)));
    },
  };
}

function subagentRefusal(result: AdmitResult): string {
  switch (result.kind) {
    case 'started':
      return 'The sub-agent chat is gone.';
    case 'thread_not_found':
      return 'The chat or its agent is gone.';
    case 'busy':
      return 'The sub-agent is already running.';
    case 'no_provider':
    case 'not_continuable':
      return result.reason;
    case 'provider_unavailable':
      return `The provider is not available right now (${result.reason}).`;
    case 'binding_changed':
      return 'The provider changed while the sub-agent was starting. Try again.';
    case 'session_choice_required':
      return `The provider session needs a choice (${result.reason}).`;
    case 'attachments_missing':
      return 'A sub-agent takes no files.';
  }
}
