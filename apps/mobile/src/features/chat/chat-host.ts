import type {
  Agent,
  AgentInstructionsView,
  AgentList,
  ApiError,
  ApprovalReplyRequest,
  ContinueResponse,
  Cursor,
  EventServerFrame,
  PluginEntry,
  PluginList,
  ProviderInfoResponse,
  SendMessageResponse,
  StopGenerationResponse,
  Thread,
  ThreadList,
  ThreadState,
  UpdateAgentRequest,
} from '@morrowbot/contracts';

/** A host call's result. Values are already parsed with the shared contracts. `status` 0: never reached the host. */
export type HostResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed'; readonly status: number; readonly error: ApiError['error'] };

/**
 * Everything the chat asks of a paired host. The connection slice implements it over HTTP and the
 * `/api/events` WebSocket; until one is wired in, the chat runs against `sampleChatHost`.
 */
export interface ChatHost {
  /** The host's display name, such as "Studio Host". */
  readonly hostName: string;
  agents(): Promise<HostResult<AgentList>>;
  threads(agentId: string): Promise<HostResult<ThreadList>>;
  createThread(agentId: string): Promise<HostResult<Thread>>;
  threadState(threadId: string): Promise<HostResult<ThreadState>>;
  send(threadId: string, text: string): Promise<HostResult<SendMessageResponse>>;
  continueTurn(threadId: string, failedMessageId: string): Promise<HostResult<ContinueResponse>>;
  stop(threadId: string): Promise<HostResult<StopGenerationResponse>>;
  answerApproval(threadId: string, approvalId: string, reply: ApprovalReplyRequest): Promise<HostResult<null>>;
  providerInfo(pluginId: string): Promise<HostResult<ProviderInfoResponse>>;
  updateAgent(agentId: string, request: UpdateAgentRequest): Promise<HostResult<Agent>>;
  deleteAgent(agentId: string): Promise<HostResult<null>>;
  instructions(agentId: string): Promise<HostResult<AgentInstructionsView>>;
  plugins(): Promise<HostResult<PluginList>>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<HostResult<PluginEntry>>;
  /** Follows one thread's events from `since`. Returns the unsubscribe. */
  follow(threadId: string, since: Cursor, onFrame: (frame: EventServerFrame) => void): () => void;
}
