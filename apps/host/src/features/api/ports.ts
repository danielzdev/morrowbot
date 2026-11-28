import type {
  Connector,
  ConnectorScope,
  CreateConnectorRequest,
  SetConnectorScopeRequest,
  UpdateConnectorAccountRequest,
  Agent,
  Attachment,
  AttachmentContent,
  CreateMemoryRequest,
  Memory,
  SkillList,
  UpdateMemoryRequest,
  UploadAttachmentRequest,
  AgentMessage,
  AgentInstructionsView,
  ClaimInviteRequest,
  ClaimPairingRequest,
  CreateInviteRequest,
  Member,
  CreateRoutineRequest,
  BlockedGroup,
  ChatEvent,
  ChatSettings,
  MessageReaction,
  SetReactionRequest,
  CreateAgentRequest,
  CreateFolderRequest,
  CreateThreadRequest,
  Cursor,
  Folder,
  LastMessage,
  Message,
  OpenWaitRequest,
  PairedDevice,
  PluginConfig,
  PluginManifest,
  PluginOrigin,
  PluginProblem,
  PluginStatus,
  SendAgentMessageRequest,
  ProviderInfo,
  QueuedMessage,
  ProviderUnavailableReason,
  RegisterT3WatchRequest,
  Routine,
  RoutineRun,
  RunRoutineRequest,
  SessionChoice,
  SessionChoiceReason,
  StopGenerationResponse,
  T3Watch,
  T3WatchAck,
  Thread,
  ThreadState,
  ThreadSummary,
  TokenRange,
  TokenUsageResponse,
  UpdateAgentRequest,
  UpdateFolderRequest,
  UpdateRoutineRequest,
  UsageResponse,
  UserMessage,
  Wait,
  CreateVaultItemRequest,
  UpdateVaultItemRequest,
  VaultItem,
} from '@morrowbot/contracts';

export interface ApiAgents {
  list(): Agent[];
  get(id: string): Agent | undefined;
  create(request: CreateAgentRequest): Promise<ApiCreateAgentResult>;
  update(id: string, request: UpdateAgentRequest): ApiUpdateAgentResult;
  instructionsView(id: string): Promise<AgentInstructionsView | undefined>;
  createInstructions(id: string, content: string): Promise<{ readonly kind: 'created'; readonly revision: string } | { readonly kind: 'occupied' } | WriteFailure | undefined>;
  saveInstructionsCopy(id: string, content: string): Promise<{ readonly kind: 'saved'; readonly name: string } | WriteFailure | undefined>;
  /** Each agent's newest message with text, for the sidebar. */
  lastMessages(): LastMessage[];
}

export type ApiCreateAgentResult =
  | { readonly kind: 'created'; readonly agent: Agent }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'instructions-occupied'; readonly current: AgentInstructionsView }
  | WriteFailure;

/** A file the host could not write, with a reason that never names a path. */
export interface WriteFailure {
  readonly kind: 'failed';
  readonly message: string;
}

export type ApiUpdateAgentResult =
  | { readonly kind: 'updated'; readonly agent: Agent }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface ApiFolders {
  list(): Folder[];
  create(request: CreateFolderRequest): Folder;
  rename(id: string, request: UpdateFolderRequest): Folder | undefined;
  delete(id: string): boolean;
}

/** How a send or Continue was admitted, or why nothing was written. */
export type ApiAdmitResult =
  | { readonly kind: 'started'; readonly generationId: string; readonly userMessage: UserMessage | null }
  | { readonly kind: 'thread_not_found' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'no_provider'; readonly reason: string }
  | { readonly kind: 'provider_unavailable'; readonly reason: ProviderUnavailableReason }
  | { readonly kind: 'binding_changed' }
  | { readonly kind: 'session_choice_required'; readonly reason: SessionChoiceReason }
  | { readonly kind: 'not_continuable'; readonly reason: string }
  | { readonly kind: 'attachments_missing' };

/** A send starts a turn, or waits in the thread's queue while a turn runs. */
export type ApiSendResult = ApiAdmitResult | { readonly kind: 'queued'; readonly queued: QueuedMessage };

export type ApiArchiveThreadResult =
  | { readonly kind: 'archived'; readonly thread: Thread }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

export type ApiThreadArchiveFilter = 'active' | 'archived' | 'all';

export type ApiQueueAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

export type ApiReplay = { readonly kind: 'events'; readonly events: readonly ChatEvent[] } | { readonly kind: 'resync' };

export interface ApiChat {
  listThreads(agentId: string, filter?: ApiThreadArchiveFilter): Thread[] | undefined;
  listThreadSummaries(): ThreadSummary[];
  createThread(agentId: string, request: CreateThreadRequest): Thread | undefined;
  getThread(id: string): Thread | undefined;
  renameThread(id: string, title: string): Thread | undefined;
  archiveThread(id: string): ApiArchiveThreadResult;
  restoreThread(id: string): Thread | undefined;
  deleteThread(id: string): Promise<boolean>;
  deleteAgent(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  state(threadId: string): ThreadState | undefined;
  send(threadId: string, text: string, attachmentIds: readonly string[], choice: SessionChoice): Promise<ApiSendResult>;
  setReaction(
    threadId: string,
    request: SetReactionRequest,
  ): { readonly kind: 'set'; readonly reactions: MessageReaction[] } | { readonly kind: 'not_found' } | { readonly kind: 'conflict'; readonly reason: string };
  cancelQueued(threadId: string, queuedId: string): ApiQueueAnswer;
  steerQueued(threadId: string, queuedId: string): ApiQueueAnswer;
  continueTurn(threadId: string, failedMessageId: string, choice: SessionChoice): Promise<ApiAdmitResult>;
  stop(threadId: string): Promise<StopGenerationResponse | { readonly kind: 'not_stored' }>;
  replyApproval(
    threadId: string,
    generationId: string,
    approvalId: string,
    choiceId: string,
  ): { readonly kind: 'replied' } | { readonly kind: 'not_found' };
  recheck(
    pluginId: string,
  ): Promise<
    | { readonly kind: 'ok'; readonly info: ProviderInfo }
    | { readonly kind: 'busy' }
    | { readonly kind: 'blocked'; readonly detail: string }
    | { readonly kind: 'unavailable'; readonly reason: string }
  >;
  usage(
    pluginId: string,
    refresh: boolean,
  ): Promise<{ readonly kind: 'ok'; readonly response: UsageResponse } | { readonly kind: 'unavailable'; readonly reason: string }>;
  replay(threadId: string, since: Cursor): ApiReplay;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  watchThreads(listener: (summary: ThreadSummary) => void): () => void;
}

/** The plugin host, plus the settings it saved. */
export interface ApiPlugins {
  list(): readonly { readonly manifest: PluginManifest; readonly source: PluginOrigin; readonly status: PluginStatus }[];
  readonly safeMode: boolean;
  /** The user's plugins folder. */
  readonly pluginsDir: string;
  problems(): readonly PluginProblem[];
  rescan(): Promise<void>;
  restart(pluginId: string): Promise<'restarted' | 'safe-mode' | 'disabled' | 'quarantined' | 'busy'>;
  blockedGroups(pluginId: string): BlockedGroup[];
  saved(pluginId: string): Promise<{ readonly enabled: boolean; readonly config: PluginConfig } | undefined>;
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  setConfig(
    pluginId: string,
    config: PluginConfig,
  ): Promise<{ readonly kind: 'ok' } | { readonly kind: 'invalid'; readonly problems: readonly string[] }>;
  info(
    pluginId: string,
    refresh: boolean,
  ): Promise<{ readonly kind: 'ok'; readonly info: ProviderInfo } | { readonly kind: 'unavailable'; readonly reason: string }>;
  releaseGroup(regId: string): 'released' | 'not-found' | 'not-blocked' | 'too-early';
}

/** Local token counts from `turn_usage`. */
export interface ApiUsage {
  tokens(range: TokenRange): TokenUsageResponse;
}

export interface ApiPairing {
  createCode(): { readonly code: string; readonly expiresAt: string };
  /** `source` is the peer's address: wrong codes are throttled per source. */
  claim(
    request: ClaimPairingRequest,
    source: string,
  ):
    | { readonly kind: 'claimed'; readonly deviceId: string; readonly token: string }
    | { readonly kind: 'wrong-code' }
    | { readonly kind: 'rate-limited' };
  /** The active paired device holding `token`. */
  authenticate(token: string): string | undefined;
  list(): PairedDevice[];
  revoke(deviceId: string): boolean;
}

/** People the owner invited to this server. */
export interface ApiMembers {
  invite(
    request: Omit<CreateInviteRequest, 'url'>,
  ): { readonly kind: 'invited'; readonly member: Member; readonly code: string } | { readonly kind: 'invalid'; readonly reason: string };
  claim(request: ClaimInviteRequest): { readonly kind: 'claimed'; readonly memberId: string; readonly token: string } | { readonly kind: 'wrong-code' };
  /** The joined, unrevoked member holding `token`, with its access as stored now. */
  authenticate(token: string): Member | undefined;
  list(): Member[];
  revoke(memberId: string): boolean;
}

export interface ApiAttachments {
  upload(
    threadId: string,
    request: UploadAttachmentRequest,
  ): Promise<{ readonly kind: 'saved'; readonly attachment: Attachment } | { readonly kind: 'not-found' } | { readonly kind: 'invalid'; readonly reason: string }>;
  content(id: string): Promise<AttachmentContent | undefined>;
  /** The thread an attachment was uploaded to, or undefined for an unknown id. */
  threadOf(id: string): string | undefined;
}

/** Each call is undefined for an unknown agent (or memory). */
export interface ApiMemories {
  list(agentId: string, query: string): Memory[] | undefined;
  create(agentId: string, request: CreateMemoryRequest): Memory | undefined;
  update(agentId: string, id: string, request: UpdateMemoryRequest): Memory | undefined;
  delete(agentId: string, id: string): boolean;
}

export interface ApiSkills {
  /** The agent's skills; undefined for an unknown agent. */
  list(agentId: string): Promise<SkillList | undefined>;
}

/** Agent-to-agent messages. `send` refuses with a reason before writing anything. */
export interface ApiAgentMessages {
  send(
    senderId: string,
    request: SendAgentMessageRequest,
  ):
    | { readonly kind: 'sent'; readonly message: AgentMessage }
    | { readonly kind: 'not-found'; readonly what: string }
    | { readonly kind: 'invalid' | 'forbidden' | 'conflict' | 'rate-limited'; readonly reason: string };
  /** Undefined for an unknown agent, or a thread that is not the agent's. */
  list(agentId: string, threadId: string | null): AgentMessage[] | undefined;
  subscribe(listener: (message: AgentMessage) => void): () => void;
}

export type ApiRoutineSave =
  | { readonly kind: 'saved'; readonly routine: Routine }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface ApiRoutines {
  list(agentId?: string): Routine[];
  create(request: CreateRoutineRequest): ApiRoutineSave;
  update(id: string, request: UpdateRoutineRequest): ApiRoutineSave;
  delete(id: string): boolean;
  run(
    id: string,
    request: RunRoutineRequest,
  ): Promise<
    | { readonly kind: 'started'; readonly run: RoutineRun }
    | { readonly kind: 'not-found' }
    | { readonly kind: 'busy' }
    | { readonly kind: 'invalid'; readonly reason: string }
    | { readonly kind: 'wait-closed' }
  >;
  listWaits(): Wait[];
  openWait(request: OpenWaitRequest): { readonly kind: 'opened'; readonly wait: Wait } | { readonly kind: 'invalid'; readonly reason: string };
  closeWait(waitId: string): boolean;
}

/** T3 Code threads the host watches for the orchestrator. */
export interface ApiT3Watches {
  register(request: RegisterT3WatchRequest): T3Watch;
  list(): T3Watch[];
  remove(watchId: string): boolean;
  ack(ack: T3WatchAck): { readonly kind: 'acked' | 'already_acked' | 'unknown_batch' };
}

/** Settings › Chat. */
export interface ApiSettings {
  chat(): ChatSettings;
  setChat(settings: ChatSettings): ChatSettings;
}

export type ApiVaultSave = { readonly kind: 'saved'; readonly item: VaultItem } | { readonly kind: 'not-found' } | { readonly kind: 'invalid'; readonly reason: string };

/** The owner's saved logins, API keys and header secrets: names in and out, secret values only in. */
export interface ApiVault {
  list(): VaultItem[];
  create(request: CreateVaultItemRequest): Promise<ApiVaultSave>;
  update(id: string, request: UpdateVaultItemRequest): Promise<ApiVaultSave>;
  delete(id: string): Promise<boolean>;
}

export type ApiConnectorSave =
  | { readonly kind: 'saved'; readonly connector: Connector }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'label-taken' }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Connectors: custom MCP servers and Composio accounts, each with its own scope record. */
export interface ApiConnectors {
  readonly safeMode: boolean;
  list(): Connector[];
  create(request: CreateConnectorRequest): ApiConnectorSave;
  updateAccount(id: string, request: UpdateConnectorAccountRequest): ApiConnectorSave;
  setEnabled(id: string, enabled: boolean): Connector | undefined;
  setScope(
    id: string,
    request: SetConnectorScopeRequest,
  ):
    | { readonly kind: 'saved'; readonly connector: Connector }
    | { readonly kind: 'not-found' }
    | { readonly kind: 'conflict'; readonly current: ConnectorScope }
    | { readonly kind: 'invalid'; readonly reason: string };
  connect(id: string): Connector | undefined;
  disconnect(id: string): Connector | undefined;
  remove(id: string): Promise<boolean>;
  get(id: string): Connector | undefined;
  /** Settles once the connector's latest connect or disconnect has. */
  settled(id: string): Promise<void>;
}

export interface ApiServices {
  readonly connectors: ApiConnectors;
  readonly agents: ApiAgents;
  readonly attachments: ApiAttachments;
  readonly memories: ApiMemories;
  readonly skills: ApiSkills;
  readonly folders: ApiFolders;
  readonly chat: ApiChat;
  readonly plugins: ApiPlugins;
  readonly usage: ApiUsage;
  readonly pairing: ApiPairing;
  readonly members: ApiMembers;
  readonly agentMessages: ApiAgentMessages;
  readonly routines: ApiRoutines;
  readonly t3Watches: ApiT3Watches;
  readonly settings: ApiSettings;
  readonly vault: ApiVault;
}
