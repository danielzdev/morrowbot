import type {
  Agent,
  ChatEvent,
  CreateAgentRequest,
  CreateThreadRequest,
  Message,
  PluginConfig,
  PluginManifest,
  PluginStatus,
  StopGenerationResponse,
  Thread,
  UpdateAgentRequest,
  UserMessage,
} from '@morrowbot/contracts';

export interface ApiAgents {
  list(): Agent[];
  get(id: string): Agent | undefined;
  create(request: CreateAgentRequest): Promise<ApiCreateAgentResult>;
  update(id: string, request: UpdateAgentRequest): Agent | undefined;
  readInstructions(id: string): Promise<string | undefined>;
  writeInstructions(id: string, content: string): Promise<boolean>;
}

export type ApiCreateAgentResult =
  | { readonly kind: 'created'; readonly agent: Agent }
  | { readonly kind: 'invalid'; readonly reason: string };

export type ApiSendResult =
  | { readonly kind: 'started'; readonly generationId: string; readonly userMessage: UserMessage }
  | { readonly kind: 'thread_not_found' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'no_provider'; readonly reason: string };

export interface ApiChat {
  listThreads(agentId: string): Thread[] | undefined;
  createThread(agentId: string, request: CreateThreadRequest): Thread | undefined;
  getThread(id: string): Thread | undefined;
  renameThread(id: string, title: string): Thread | undefined;
  deleteThread(id: string): Promise<boolean>;
  deleteAgent(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  send(threadId: string, text: string): ApiSendResult;
  stop(threadId: string): Promise<StopGenerationResponse>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
}

/** The plugin host, plus the settings it saved. */
export interface ApiPlugins {
  list(): readonly { readonly manifest: PluginManifest; readonly status: PluginStatus }[];
  saved(pluginId: string): Promise<{ readonly enabled: boolean; readonly config: PluginConfig } | undefined>;
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  setConfig(
    pluginId: string,
    config: PluginConfig,
  ): Promise<{ readonly kind: 'ok' } | { readonly kind: 'invalid'; readonly problems: readonly string[] }>;
}

export interface ApiServices {
  readonly agents: ApiAgents;
  readonly chat: ApiChat;
  readonly plugins: ApiPlugins;
}
