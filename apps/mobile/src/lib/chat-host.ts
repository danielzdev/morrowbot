import type {
  Agent,
  AgentInstructionsView,
  AgentList,
  ApiError,
  ApprovalReplyRequest,
  Attachment,
  ContinueResponse,
  PluginEntry,
  PluginList,
  ProviderInfoResponse,
  SendMessageResponse,
  StopGenerationResponse,
  Thread,
  ThreadList,
  UpdateAgentRequest,
  UploadAttachmentRequest,
} from '@morrowbot/contracts';
import type { ThreadWatcher } from './host-connection.ts';

/** A host call's result. Values are already parsed with the shared contracts. `status` 0: never reached the host. */
export type ChatResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed'; readonly status: number; readonly error: ApiError['error'] };

/**
 * Everything the chat and Extensions ask of a host. `features/connection` implements it over the
 * paired host's transport; with no host paired, the chat runs against its in-memory sample host.
 */
export interface ChatHost {
  /** The host's display name, such as "Studio Host". */
  readonly hostName: string;
  agents(): Promise<ChatResult<AgentList>>;
  threads(agentId: string): Promise<ChatResult<ThreadList>>;
  createThread(agentId: string): Promise<ChatResult<Thread>>;
  /** Uploads one file to the thread; a later `send` names its id to carry it. */
  uploadAttachment(threadId: string, request: UploadAttachmentRequest): Promise<ChatResult<Attachment>>;
  send(threadId: string, text: string, attachmentIds: readonly string[]): Promise<ChatResult<SendMessageResponse>>;
  continueTurn(threadId: string, failedMessageId: string): Promise<ChatResult<ContinueResponse>>;
  stop(threadId: string): Promise<ChatResult<StopGenerationResponse>>;
  answerApproval(threadId: string, approvalId: string, reply: ApprovalReplyRequest): Promise<ChatResult<null>>;
  providerInfo(pluginId: string): Promise<ChatResult<ProviderInfoResponse>>;
  updateAgent(agentId: string, request: UpdateAgentRequest): Promise<ChatResult<Agent>>;
  deleteAgent(agentId: string): Promise<ChatResult<null>>;
  instructions(agentId: string): Promise<ChatResult<AgentInstructionsView>>;
  plugins(): Promise<ChatResult<PluginList>>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<ChatResult<PluginEntry>>;
  /** Hears every plugin change the host reports, including this app's own `setPluginEnabled`. Returns the unsubscribe. */
  onPluginChanged(listener: (entry: PluginEntry) => void): () => void;
  /**
   * Follows one thread: its `/state` first, then a `subscribe` from that state's cursor, again on
   * every reconnect. Returns the function that stops watching (an `unsubscribe`).
   */
  watch(threadId: string, watcher: ThreadWatcher): () => void;
}
