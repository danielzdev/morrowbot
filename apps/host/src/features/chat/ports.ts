import type {
  Agent,
  AgentMessage,
  AgentMessageReadOutcome,
  Attachment,
  AttachmentContent,
  BlockedGroup,
  BoundProvider,
  ChatEvent,
  ChatSettings,
  HostTools,
  LastMessage,
  Message,
  MessageReaction,
  MessageToolSteps,
  ProviderInfo,
  Thread,
  TurnChunk,
  TurnEnd,
  TurnOutcome,
  TurnRequest,
  TurnUsage,
  ToolStep,
  ReactionActor,
  UsageResult,
  UsageWindow,
  VendorSettings,
} from '@morrowbot/contracts';
import type { TurnOutputBudget } from './output-budget.ts';
import type { Prelude } from './prompt.ts';

export type SessionState = 'clean' | 'diverged' | 'needs-seed';

export interface QueuedRecord {
  readonly id: string;
  readonly threadId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface SessionKey {
  readonly pluginId: string;
  readonly accountKey: string;
  readonly routeKey: string;
  readonly cwd: string;
  readonly threadId: string;
}

export interface SessionRecord {
  readonly id: number;
  readonly key: SessionKey;
  readonly ref: string;
  readonly systemHash: string;
  readonly vendorSettings: VendorSettings;
  readonly state: SessionState;
}

/** A sub-agent's chat (`threadId`), a hidden child of the chat whose turn `parentGenerationId` started it. */
export interface SubagentRecord {
  readonly threadId: string;
  readonly parentThreadId: string;
  readonly parentGenerationId: string;
  readonly role: string;
  readonly binding: BoundProvider;
  readonly createdAt: string;
}

/** The storage the chat feature needs (the storage feature provides it). */
export interface ChatStore {
  readonly threads: {
    insert(thread: Omit<Thread, 'createdSeq'>): Thread;
    update(thread: Thread): void;
    touch(id: string, at: string): void;
    delete(id: string): boolean;
    get(id: string): Thread | undefined;
    listByAgent(agentId: string): Thread[];
    listAll(): Thread[];
  };
  readonly messages: {
    insert(message: Message): void;
    get(id: string): Message | undefined;
    listByThread(threadId: string): Message[];
    /** The thread's newest message with text, or null. */
    lastInThread(threadId: string): LastMessage | null;
    /** Whether the thread's newest message is a reply that failed. */
    endsFailed(threadId: string): boolean;
  };
  /** Each turn's tool calls, saved as they start and end (see the storage feature's tool-steps repository). */
  readonly toolSteps: {
    start(step: {
      readonly generationId: string;
      readonly toolUseId: string;
      readonly name: string;
      readonly input: ToolStep['input'];
      readonly startedAt: string;
    }): void;
    end(generationId: string, toolUseId: string, outcome: 'ok' | 'error', endedAt: string): void;
    listOpen(generationId: string): ToolStep[];
    close(generationId: string, messageId: string | null): void;
    listByThread(threadId: string): MessageToolSteps[];
  };
  readonly reactions: {
    /** False when the actor already has this emoji on the message. */
    add(reaction: MessageReaction): boolean;
    remove(messageId: string, actor: ReactionActor, emoji: string): boolean;
    listByMessage(messageId: string): MessageReaction[];
    listByThread(threadId: string): MessageReaction[];
  };
  /** Settings › Chat. */
  readonly settings: { get(): ChatSettings };
  /** Messages sent while a turn ran that the agent has not seen yet. */
  readonly queued: {
    insert(record: QueuedRecord): void;
    delete(id: string): boolean;
    listByThread(threadId: string): QueuedRecord[];
  };
  readonly generations: {
    insert(record: {
      readonly id: string;
      readonly threadId: string;
      readonly pluginId: string;
      readonly accountKey: string;
      readonly inputMessageId: string;
      readonly startedAt: string;
      readonly attemptedSessionRow: number | null;
      readonly priorState: SessionState | null;
    }): void;
    markDispatched(id: string, at: string): void;
    setAttemptedSessionRow(id: string, row: number): void;
    setInputMessage(id: string, messageId: string): void;
    flushPartial(id: string, text: string): void;
    settle(id: string, resultMessageId: string | null): void;
    hasInput(messageId: string): boolean;
    unsettled(): readonly {
      readonly id: string;
      readonly threadId: string;
      readonly inputMessageId: string;
      readonly partialText: string;
    }[];
    byResultMessage(messageId: string): { readonly id: string; readonly inputMessageId: string } | undefined;
    idsByThread(threadId: string): Set<string>;
    continuation(threadId: string, failedMessageId: string): string | undefined;
    insertContinuation(threadId: string, failedMessageId: string, generationId: string, at: string): void;
    insertUsage(record: {
      readonly generationId: string;
      readonly agentId: string;
      readonly threadId: string;
      readonly pluginId: string;
      readonly accountKey: string;
      readonly actualModel: string | null;
      readonly usage: TurnUsage;
      readonly outcome: TurnOutcome;
      readonly createdAt: string;
    }): void;
  };
  readonly sessions: {
    find(key: SessionKey): SessionRecord | undefined;
    get(id: number): SessionRecord | undefined;
    bind(key: SessionKey, ref: string, systemHash: string, vendorSettings: VendorSettings): number;
    setState(id: number, state: SessionState): void;
    delete(id: number): void;
    markOthersNeedSeed(key: SessionKey): void;
  };
  readonly usage: {
    merge(pluginId: string, accountKey: string, observedAt: string, windows: readonly UsageWindow[]): void;
    read(pluginId: string, accountKey: string): { readonly observedAt: string; readonly windows: readonly UsageWindow[] } | undefined;
  };
  readonly attachments: {
    pending(threadId: string, ids: readonly string[]): Attachment[] | undefined;
  };
  readonly agentMessages: {
    setReadOutcome(id: string, outcome: AgentMessageReadOutcome): void;
  };
  readonly subagents: {
    get(threadId: string): SubagentRecord | undefined;
    listByParent(parentThreadId: string): SubagentRecord[];
    /** Deletes the sub-agents whose turn was never admitted; returns how many. */
    deleteUnstarted(): number;
  };
  /** Threads a recorded turn process group still holds. */
  heldThreads(): Set<string>;
  transaction<T>(work: () => T): T;
}

export interface AgentDirectory {
  get(id: string): Agent | undefined;
  delete(id: string): boolean;
  readInstructions(id: string): Promise<string | undefined>;
}

/** `answered`: the recipient already replied during the turn (with the `send_message` tool), so nothing more is sent. */
export type ReplyAnswer = { readonly kind: 'sent' } | { readonly kind: 'answered' } | { readonly kind: 'refused'; readonly reason: string };

/** Messages from other agents, each read once in a background turn (the agent-messages feature provides them). */
export interface AgentInbox {
  /** Messages no turn has read yet, oldest first: those to `threadId`, or to every chat when null. */
  waiting(threadId: string | null): AgentMessage[];
  /** Sends `text` from the chat `message` arrived in, as its recipient's reply. */
  reply(message: AgentMessage, text: string): ReplyAnswer;
}

/** `superseded`: Recheck or a daemon exit moved the daemon revision while it was asked. */
export type InfoAnswer =
  | { readonly kind: 'ok'; readonly info: ProviderInfo; readonly worker: number; readonly daemonRevision: number }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type RecheckAnswer =
  | { readonly kind: 'ok'; readonly info: ProviderInfo }
  | { readonly kind: 'busy' }
  | { readonly kind: 'blocked'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type RouteAnswer =
  | { readonly kind: 'known'; readonly accountKey: string; readonly routeKey: string; readonly worker: number }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'daemon-blocked' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface TurnSink {
  onChunk(chunk: TurnChunk): void;
  onEnd(end: TurnEnd): void;
  onLost(): void;
}

/** The provider plugins as the chat feature sees them (the plugins feature provides them). */
export interface ProviderPlugins {
  isProvider(pluginId: string): boolean;
  revision(pluginId: string): { readonly configRevision: number; readonly worker: number | null; readonly daemonRevision: number };
  info(pluginId: string, refresh: boolean): Promise<InfoAnswer>;
  cachedInfo(pluginId: string): { readonly info: ProviderInfo; readonly worker: number } | undefined;
  usage(
    pluginId: string,
    refresh: boolean,
  ): Promise<
    | { readonly kind: 'ok'; readonly usage: UsageResult; readonly worker: number }
    | { readonly kind: 'unavailable'; readonly reason: string }
  >;
  routeInfo(pluginId: string, cwd: string): Promise<RouteAnswer>;
  startTurn(pluginId: string, worker: number, request: TurnRequest, sink: TurnSink): 'started' | 'binding-changed';
  /** Whether `startTurn` on `worker` would be accepted now: checked before the dispatch writes anything. */
  canStart(pluginId: string, worker: number): boolean;
  /** Links the turn to the daemon serving `worker`, if any. Called inside the dispatch transaction. */
  linkDaemon(pluginId: string, worker: number, generationId: string): void;
  /** Drops the turn's daemon link while that daemon still serves. Called inside the settlement transaction. */
  unlinkDaemon(generationId: string): void;
  /** Retires the plugin's daemon (if any) and asks a fresh provider-info; the caller has closed admission. */
  recheck(pluginId: string): Promise<RecheckAnswer>;
  cancelTurn(pluginId: string, turnId: string): void;
  /** Sends the user's message into a running turn; the plugin answers with `steer-delivered` or `steer-refused`. */
  steerTurn(pluginId: string, turnId: string, steerId: string, text: string): void;
  replyApproval(pluginId: string, turnId: string, approvalId: string, choiceId: string): void;
  /** Whether any process group (live or blocked) still belongs to the generation. */
  holdsGeneration(generationId: string): boolean;
  /** Whether a group of the generation is still being checked (neither released nor blocked yet). */
  cleaningUp(generationId: string): boolean;
  blockedGroups(generationIds: ReadonlySet<string>): BlockedGroup[];
  /** Hears each group release, with the generations it held. */
  onGroupReleased(listener: (generationIds: readonly string[]) => void): () => void;
  /** Hears each group that could not be confirmed gone, with the generations it holds. */
  onGroupBlocked(listener: (generationIds: readonly string[]) => void): () => void;
}

/** What a turn's prompt is made from besides the user's text (the skills, memories and attachments features provide it). */
export interface TurnContext {
  prelude(agentId: string, workspaceDir: string): Promise<Prelude>;
  readAttachment(attachment: Attachment): Promise<AttachmentContent>;
}

/** Ori Kami's own tools for one turn (the agent-tools feature provides them). */
export interface TurnTools {
  /** Tools that act only as the turn's agent, in its chat, until `close` with the same turn id. */
  open(turn: { readonly turnId: string; readonly agentId: string; readonly threadId: string }): HostTools;
  close(turnId: string): void;
}

export interface ChatServiceOptions {
  readonly store: ChatStore;
  readonly agents: AgentDirectory;
  readonly tools: TurnTools;
  readonly inbox: AgentInbox;
  readonly context: TurnContext;
  readonly plugins: ProviderPlugins;
  readonly newId: () => string;
  readonly now: () => string;
  /** A random id per host start: thread event cursors restart under a new epoch. */
  readonly hostEpoch: string;
  /** Called with errors that have no caller to return to, such as a failed write after a generation. */
  readonly report: (error: unknown) => void;
  /** Per-turn cap on streamed bytes and events; defaults to `DEFAULT_TURN_OUTPUT_BUDGET`. */
  readonly turnOutputBudget?: TurnOutputBudget;
}

export type ChatListener = (event: ChatEvent) => void;
