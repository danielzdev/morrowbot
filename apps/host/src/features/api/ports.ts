import type {
  Agent,
  ChatEvent,
  CreateAgentRequest,
  CreateThreadRequest,
  Message,
  PluginCatalog,
  PluginConfig,
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

export interface ApiPluginSettings {
  enabledStates(): ReadonlyMap<string, boolean>;
  configs(): ReadonlyMap<string, PluginConfig>;
  setEnabled(pluginId: string, enabled: boolean, at: string): void;
  setConfig(pluginId: string, config: PluginConfig, at: string): void;
}

export interface ApiServices {
  readonly agents: ApiAgents;
  readonly chat: ApiChat;
  readonly plugins: { readonly catalog: PluginCatalog; readonly settings: ApiPluginSettings };
  readonly now: () => string;
}
