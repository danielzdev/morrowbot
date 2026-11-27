import {
  Agent,
  Attachment,
  AttachmentContent,
  Memory,
  MemoryList,
  SkillList,
  CreateMemoryRequest as CreateMemoryRequestSchema,
  type UpdateMemoryRequest,
  type UploadAttachmentRequest,
  AgentMessageList,
  AgentInstructionsView,
  InstructionsCopyReply,
  PutInstructionsReply,
  AgentList,
  ApiError,
  ContinueResponse,
  Folder,
  PluginEntry,
  PluginList,
  ProviderInfoResponse,
  ReleaseGroupResponse,
  SendMessageResponse,
  StopGenerationResponse,
  Thread,
  ThreadList,
  ThreadState,
  TokenUsageResponse,
  UsageResponse,
  CreateAgentRequest,
  type PluginConfig,
  type SessionChoice,
  type TokenRange,
  type UpdateAgentRequest,
} from '@morrowbot/contracts';
import { z } from 'zod';
import type { ApiMethod, MorrowbotBridge } from '../bridge.ts';

/** Why a call did not succeed, in the host's own error shape. `status` is 0 when the call never reached main. */
export interface ApiFailure {
  readonly kind: 'failed';
  readonly status: number;
  readonly error: ApiError['error'];
}

export type ApiResult<T> = { readonly kind: 'ok'; readonly value: T } | ApiFailure;

const NoContent = z.null();

/** Every host call the window makes. Replies are parsed here, once, with the shared contracts. */
export interface Api {
  listAgents(): Promise<ApiResult<AgentList>>;
  createAgent(request: z.input<typeof CreateAgentRequest>): Promise<ApiResult<Agent>>;
  updateAgent(id: string, request: UpdateAgentRequest): Promise<ApiResult<Agent>>;
  deleteAgent(id: string): Promise<ApiResult<null>>;
  createFolder(name: string): Promise<ApiResult<Folder>>;
  renameFolder(id: string, name: string): Promise<ApiResult<Folder>>;
  deleteFolder(id: string): Promise<ApiResult<null>>;
  instructions(id: string): Promise<ApiResult<AgentInstructionsView>>;
  /** Creates a missing AGENTS.md (`expectedRevision: null`); the host refuses to replace one. */
  saveInstructions(id: string, content: string, expectedRevision: string | null): Promise<ApiResult<PutInstructionsReply>>;
  saveInstructionsCopy(id: string, content: string): Promise<ApiResult<InstructionsCopyReply>>;
  listThreads(agentId: string): Promise<ApiResult<ThreadList>>;
  /** Every agent's chats, newest first (H9, for ⌘K). */
  listAllThreads(): Promise<ApiResult<ThreadList>>;
  createThread(agentId: string, title?: string): Promise<ApiResult<Thread>>;
  renameThread(id: string, title: string): Promise<ApiResult<Thread>>;
  deleteThread(id: string): Promise<ApiResult<null>>;
  threadState(id: string): Promise<ApiResult<ThreadState>>;
  send(threadId: string, text: string, attachmentIds: readonly string[], sessionChoice: SessionChoice): Promise<ApiResult<SendMessageResponse>>;
  uploadAttachment(threadId: string, request: UploadAttachmentRequest): Promise<ApiResult<Attachment>>;
  attachmentContent(id: string): Promise<ApiResult<AttachmentContent>>;
  skills(agentId: string): Promise<ApiResult<SkillList>>;
  /** All the agent's memories, or those matching `query`. */
  memories(agentId: string, query: string): Promise<ApiResult<MemoryList>>;
  createMemory(agentId: string, request: z.input<typeof CreateMemoryRequestSchema>): Promise<ApiResult<Memory>>;
  updateMemory(agentId: string, id: string, request: UpdateMemoryRequest): Promise<ApiResult<Memory>>;
  deleteMemory(agentId: string, id: string): Promise<ApiResult<null>>;
  /** The agent messages shown in one of the agent's chats, oldest first. */
  agentMessages(agentId: string, threadId: string): Promise<ApiResult<AgentMessageList>>;
  continueTurn(threadId: string, failedMessageId: string, sessionChoice: SessionChoice): Promise<ApiResult<ContinueResponse>>;
  stop(threadId: string): Promise<ApiResult<StopGenerationResponse>>;
  answerApproval(threadId: string, approvalId: string, generationId: string, choiceId: string): Promise<ApiResult<null>>;
  listPlugins(): Promise<ApiResult<PluginList>>;
  setPluginEnabled(id: string, enabled: boolean): Promise<ApiResult<PluginEntry>>;
  setPluginConfig(id: string, config: PluginConfig): Promise<ApiResult<PluginEntry>>;
  providerInfo(id: string, refresh: boolean): Promise<ApiResult<ProviderInfoResponse>>;
  recheck(id: string): Promise<ApiResult<ProviderInfoResponse>>;
  usage(id: string, refresh: boolean): Promise<ApiResult<UsageResponse>>;
  /** Local token counts over a range (H5). */
  tokenUsage(range: TokenRange): Promise<ApiResult<TokenUsageResponse>>;
  releaseGroup(regId: string): Promise<ApiResult<ReleaseGroupResponse>>;
}

const at = (...segments: readonly string[]): string => `/api/${segments.map(encodeURIComponent).join('/')}`;

export function createApi(bridge: MorrowbotBridge): Api {
  async function call<T>(schema: z.ZodType<T>, method: ApiMethod, path: string, body?: unknown): Promise<ApiResult<T>> {
    let reply;
    try {
      reply = await bridge.request(method, path, body);
    } catch (error) {
      return internal(0, error instanceof Error ? error.message : 'The request did not reach the host');
    }
    if (reply.status >= 200 && reply.status < 300) {
      const parsed = schema.safeParse(reply.body);
      return parsed.success ? { kind: 'ok', value: parsed.data } : internal(reply.status, 'The host sent a reply this window does not understand');
    }
    const refused = ApiError.safeParse(reply.body);
    return refused.success
      ? { kind: 'failed', status: reply.status, error: refused.data.error }
      : internal(reply.status, `The host refused the request (${String(reply.status)})`);
  }

  return {
    listAgents: () => call(AgentList, 'GET', at('agents')),
    createAgent: (request) => call(Agent, 'POST', at('agents'), request),
    updateAgent: (id, request) => call(Agent, 'PATCH', at('agents', id), request),
    deleteAgent: (id) => call(NoContent, 'DELETE', at('agents', id)),
    createFolder: (name) => call(Folder, 'POST', at('folders'), { name }),
    renameFolder: (id, name) => call(Folder, 'PATCH', at('folders', id), { name }),
    deleteFolder: (id) => call(NoContent, 'DELETE', at('folders', id)),
    instructions: (id) => call(AgentInstructionsView, 'GET', at('agents', id, 'instructions')),
    saveInstructions: (id, content, expectedRevision) => call(PutInstructionsReply, 'PUT', at('agents', id, 'instructions'), { content, expectedRevision }),
    saveInstructionsCopy: (id, content) => call(InstructionsCopyReply, 'POST', at('agents', id, 'instructions', 'copies'), { content }),
    listThreads: (agentId) => call(ThreadList, 'GET', at('agents', agentId, 'threads')),
    listAllThreads: () => call(ThreadList, 'GET', at('threads')),
    createThread: (agentId, title) => call(Thread, 'POST', at('agents', agentId, 'threads'), title === undefined ? {} : { title }),
    renameThread: (id, title) => call(Thread, 'PATCH', at('threads', id), { title }),
    deleteThread: (id) => call(NoContent, 'DELETE', at('threads', id)),
    threadState: (id) => call(ThreadState, 'GET', at('threads', id, 'state')),
    send: (threadId, text, attachmentIds, sessionChoice) =>
      call(SendMessageResponse, 'POST', at('threads', threadId, 'messages'), { text, attachmentIds, sessionChoice }),
    uploadAttachment: (threadId, request) => call(Attachment, 'POST', at('threads', threadId, 'attachments'), request),
    attachmentContent: (id) => call(AttachmentContent, 'GET', at('attachments', id)),
    skills: (agentId) => call(SkillList, 'GET', at('agents', agentId, 'skills')),
    memories: (agentId, query) => call(MemoryList, 'GET', `${at('agents', agentId, 'memories')}${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`),
    createMemory: (agentId, request) => call(Memory, 'POST', at('agents', agentId, 'memories'), request),
    updateMemory: (agentId, id, request) => call(Memory, 'PATCH', at('agents', agentId, 'memories', id), request),
    deleteMemory: (agentId, id) => call(NoContent, 'DELETE', at('agents', agentId, 'memories', id)),
    agentMessages: (agentId, threadId) =>
      call(AgentMessageList, 'GET', `${at('agents', agentId, 'messages')}?${new URLSearchParams({ threadId }).toString()}`),
    continueTurn: (threadId, failedMessageId, sessionChoice) =>
      call(ContinueResponse, 'POST', at('threads', threadId, 'continue'), { failedMessageId, sessionChoice }),
    stop: (threadId) => call(StopGenerationResponse, 'POST', at('threads', threadId, 'stop')),
    answerApproval: (threadId, approvalId, generationId, choiceId) =>
      call(NoContent, 'POST', at('threads', threadId, 'approvals', approvalId), { generationId, choiceId }),
    listPlugins: () => call(PluginList, 'GET', at('plugins')),
    setPluginEnabled: (id, enabled) => call(PluginEntry, 'PUT', at('plugins', id, 'enabled'), { enabled }),
    setPluginConfig: (id, config) => call(PluginEntry, 'PUT', at('plugins', id, 'config'), { config }),
    providerInfo: (id, refresh) => call(ProviderInfoResponse, 'GET', `${at('plugins', id, 'info')}${refresh ? '?refresh=1' : ''}`),
    recheck: (id) => call(ProviderInfoResponse, 'POST', at('plugins', id, 'recheck')),
    usage: (id, refresh) => call(UsageResponse, 'GET', `${at('plugins', id, 'usage')}${refresh ? '?refresh=1' : ''}`),
    tokenUsage: (range) => call(TokenUsageResponse, 'GET', `${at('usage', 'tokens')}?range=${range}`),
    releaseGroup: (regId) => call(ReleaseGroupResponse, 'POST', at('child-groups', regId, 'release')),
  };
}

function internal(status: number, message: string): ApiFailure {
  return { kind: 'failed', status, error: { kind: 'internal', message } };
}
