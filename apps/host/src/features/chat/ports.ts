import type {
  Agent,
  BlockedGroup,
  ChatEvent,
  Message,
  ProviderInfo,
  Thread,
  TurnChunk,
  TurnEnd,
  TurnOutcome,
  TurnRequest,
  TurnUsage,
  UsageResult,
  UsageWindow,
  VendorSettings,
} from '@morrowbot/contracts';

export type SessionState = 'clean' | 'diverged' | 'needs-seed';

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

/** The storage the chat feature needs (the storage feature provides it). */
export interface ChatStore {
  readonly threads: {
    insert(thread: Thread): void;
    update(thread: Thread): void;
    touch(id: string, at: string): void;
    delete(id: string): boolean;
    get(id: string): Thread | undefined;
    listByAgent(agentId: string): Thread[];
  };
  readonly messages: {
    insert(message: Message): void;
    get(id: string): Message | undefined;
    listByThread(threadId: string): Message[];
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
    flushPartial(id: string, text: string): void;
    settle(id: string, resultMessageId: string): void;
    unsettled(): readonly {
      readonly id: string;
      readonly threadId: string;
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
  /** Threads a recorded turn process group still holds. */
  heldThreads(): Set<string>;
  transaction<T>(work: () => T): T;
}

export interface AgentDirectory {
  get(id: string): Agent | undefined;
  delete(id: string): boolean;
  readInstructions(id: string): Promise<string | undefined>;
}

export type InfoAnswer =
  | { readonly kind: 'ok'; readonly info: ProviderInfo; readonly worker: number }
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
  revision(pluginId: string): { readonly configRevision: number; readonly worker: number | null };
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
  cancelTurn(pluginId: string, turnId: string): void;
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

export interface ChatServiceOptions {
  readonly store: ChatStore;
  readonly agents: AgentDirectory;
  readonly plugins: ProviderPlugins;
  readonly newId: () => string;
  readonly now: () => string;
  /** A random id per host start: thread event cursors restart under a new epoch. */
  readonly hostEpoch: string;
  /** Called with errors that have no caller to return to, such as a failed write after a generation. */
  readonly report: (error: unknown) => void;
}

export type ChatListener = (event: ChatEvent) => void;
