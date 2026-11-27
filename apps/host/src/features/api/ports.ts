import type {
  Agent,
  AgentInstructionsView,
  ClaimPairingRequest,
  BlockedGroup,
  ChatEvent,
  CreateAgentRequest,
  CreateFolderRequest,
  CreateThreadRequest,
  Cursor,
  Folder,
  LastMessage,
  Message,
  PairedDevice,
  PluginConfig,
  PluginManifest,
  PluginStatus,
  ProviderInfo,
  ProviderUnavailableReason,
  SessionChoice,
  SessionChoiceReason,
  StopGenerationResponse,
  Thread,
  ThreadState,
  TokenRange,
  TokenUsageResponse,
  UpdateAgentRequest,
  UpdateFolderRequest,
  UsageResponse,
  UserMessage,
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
  | { readonly kind: 'not_continuable'; readonly reason: string };

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
  send(threadId: string, text: string, choice: SessionChoice): Promise<ApiAdmitResult>;
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
  list(): readonly { readonly manifest: PluginManifest; readonly status: PluginStatus }[];
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

export interface ApiServices {
  readonly agents: ApiAgents;
  readonly folders: ApiFolders;
  readonly chat: ApiChat;
  readonly plugins: ApiPlugins;
  readonly usage: ApiUsage;
  readonly pairing: ApiPairing;
}
