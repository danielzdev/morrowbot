import type {
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
  ClaimPairingRequest,
  CreateRoutineRequest,
  BlockedGroup,
  ChatEvent,
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
  Routine,
  RoutineRun,
  RunRoutineRequest,
  SessionChoice,
  SessionChoiceReason,
  StopGenerationResponse,
  Thread,
  ThreadState,
  TokenRange,
  TokenUsageResponse,
  UpdateAgentRequest,
  UpdateFolderRequest,
  UpdateRoutineRequest,
  UsageResponse,
  UserMessage,
  Wait,
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
export type ApiSendResult = ApiAdmitResult | { readonly kind: 'queued'; readonly queued: QueuedMessage } | { readonly kind: 'files_wait' };

export type ApiQueueAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

export type ApiReplay = { readonly kind: 'events'; readonly events: readonly ChatEvent[] } | { readonly kind: 'resync' };

export interface ApiChat {
  listThreads(agentId: string): Thread[] | undefined;
  listAllThreads(): Thread[];
  createThread(agentId: string, request: CreateThreadRequest): Thread | undefined;
  getThread(id: string): Thread | undefined;
  renameThread(id: string, title: string): Thread | undefined;
  deleteThread(id: string): Promise<boolean>;
  deleteAgent(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  state(threadId: string): ThreadState | undefined;
  send(threadId: string, text: string, attachmentIds: readonly string[], choice: SessionChoice): Promise<ApiSendResult>;
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

export interface ApiAttachments {
  upload(
    threadId: string,
    request: UploadAttachmentRequest,
  ): Promise<{ readonly kind: 'saved'; readonly attachment: Attachment } | { readonly kind: 'not-found' } | { readonly kind: 'invalid'; readonly reason: string }>;
  content(id: string): Promise<AttachmentContent | undefined>;
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

export interface ApiServices {
  readonly agents: ApiAgents;
  readonly attachments: ApiAttachments;
  readonly memories: ApiMemories;
  readonly skills: ApiSkills;
  readonly folders: ApiFolders;
  readonly chat: ApiChat;
  readonly plugins: ApiPlugins;
  readonly usage: ApiUsage;
  readonly pairing: ApiPairing;
  readonly agentMessages: ApiAgentMessages;
  readonly routines: ApiRoutines;
}
