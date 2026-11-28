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
  Connector,
  ConnectorList,
  ContinueResponse,
  Folder,
  InviteResponse,
  lenient,
  MemberList,
  PairedDeviceList,
  WhoAmI,
  type CreateInviteRequest,
  PairingCodeResponse,
  PluginEntry,
  PluginList,
  ProviderInfoResponse,
  ReleaseGroupResponse,
  Routine,
  RoutineList,
  RunRoutineResponse,
  SendMessageResponse,
  StopGenerationResponse,
  Thread,
  ThreadList,
  ThreadSummaryList,
  ThreadState,
  TokenUsageResponse,
  UsageResponse,
  ChatSettings,
  CreateAgentRequest,
  SetReactionResponse,
  type CreateConnectorRequest,
  type CreateRoutineRequest,
  type PluginConfig,
  type SessionChoice,
  type SetReactionRequest,
  type TokenRange,
  type SetConnectorScopeRequest,
  type UpdateAgentRequest,
  type UpdateConnectorAccountRequest,
  type UpdateRoutineRequest,
  VaultItem,
  VaultItemList,
  type CreateVaultItemRequest,
  type UpdateVaultItemRequest,
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
const ApiErrorReply = lenient(ApiError);

/** Every host call the window makes. Replies are parsed leniently here, once, with the shared contracts. */
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
  listAllThreads(): Promise<ApiResult<ThreadSummaryList>>;
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
  /** Takes a message the agent has not seen out of the queue. */
  cancelQueued(threadId: string, queuedId: string): Promise<ApiResult<null>>;
  /** Steer now: into the running reply, or out as the next turn when nothing runs. */
  steerQueued(threadId: string, queuedId: string): Promise<ApiResult<null>>;
  answerApproval(threadId: string, approvalId: string, generationId: string, choiceId: string): Promise<ApiResult<null>>;
  /** Puts the user's emoji on an agent reply, or takes it off; answers that reply's reactions now. */
  setReaction(threadId: string, request: SetReactionRequest): Promise<ApiResult<SetReactionResponse>>;
  /** The host's chat settings (Settings › Chat › Emoji-only / silent replies). */
  chatSettings(): Promise<ApiResult<ChatSettings>>;
  saveChatSettings(settings: ChatSettings): Promise<ApiResult<ChatSettings>>;
  listPlugins(): Promise<ApiResult<PluginList>>;
  setPluginEnabled(id: string, enabled: boolean): Promise<ApiResult<PluginEntry>>;
  setPluginConfig(id: string, config: PluginConfig): Promise<ApiResult<PluginEntry>>;
  restartPlugin(id: string): Promise<ApiResult<PluginEntry>>;
  rescanPlugins(): Promise<ApiResult<PluginList>>;
  listConnectors(): Promise<ApiResult<ConnectorList>>;
  /** Adds a connector with the scope already chosen, so it never runs with a scope nobody chose. */
  createConnector(request: z.input<typeof CreateConnectorRequest>): Promise<ApiResult<Connector>>;
  updateConnectorAccount(id: string, request: z.input<typeof UpdateConnectorAccountRequest>): Promise<ApiResult<Connector>>;
  setConnectorEnabled(id: string, enabled: boolean): Promise<ApiResult<Connector>>;
  /** A stale `revision` fails with `scope-conflict`, carrying the current scope. */
  setConnectorScope(id: string, request: SetConnectorScopeRequest): Promise<ApiResult<Connector>>;
  /** Connect, and also Reconnect. */
  connectConnector(id: string): Promise<ApiResult<Connector>>;
  disconnectConnector(id: string): Promise<ApiResult<Connector>>;
  removeConnector(id: string): Promise<ApiResult<null>>;
  providerInfo(id: string, refresh: boolean): Promise<ApiResult<ProviderInfoResponse>>;
  recheck(id: string): Promise<ApiResult<ProviderInfoResponse>>;
  usage(id: string, refresh: boolean): Promise<ApiResult<UsageResponse>>;
  /** Local token counts over a range (H5). */
  tokenUsage(range: TokenRange): Promise<ApiResult<TokenUsageResponse>>;
  releaseGroup(regId: string): Promise<ApiResult<ReleaseGroupResponse>>;
  listRoutines(agentId: string): Promise<ApiResult<RoutineList>>;
  createRoutine(request: z.input<typeof CreateRoutineRequest>): Promise<ApiResult<Routine>>;
  updateRoutine(id: string, request: UpdateRoutineRequest): Promise<ApiResult<Routine>>;
  deleteRoutine(id: string): Promise<ApiResult<null>>;
  runRoutine(id: string): Promise<ApiResult<RunRoutineResponse>>;
  /** A one-time pairing code; `url` is where the phone reaches the host, needed when the host is not bound to one address. */
  createPairingCode(url: string | null): Promise<ApiResult<PairingCodeResponse>>;
  /** Every device ever paired, unpaired ones included (`revokedAt` set). */
  listDevices(): Promise<ApiResult<PairedDeviceList>>;
  /** Unpairs a device; the host closes its connections at once. */
  unpairDevice(id: string): Promise<ApiResult<null>>;
  /** Who this app is on the server: its owner, or a member with the access it was invited with. */
  whoAmI(): Promise<ApiResult<WhoAmI>>;
  createInvite(request: CreateInviteRequest): Promise<ApiResult<InviteResponse>>;
  /** Every member ever invited, revoked ones included. */
  listMembers(): Promise<ApiResult<MemberList>>;
  /** Revokes a member; the host closes its connections at once. */
  revokeMember(id: string): Promise<ApiResult<null>>;
  /** The vault's items: names only, never a secret. */
  listVault(): Promise<ApiResult<VaultItemList>>;
  createVaultItem(request: z.input<typeof CreateVaultItemRequest>): Promise<ApiResult<VaultItem>>;
  updateVaultItem(id: string, request: z.input<typeof UpdateVaultItemRequest>): Promise<ApiResult<VaultItem>>;
  deleteVaultItem(id: string): Promise<ApiResult<null>>;
}

const at = (...segments: readonly string[]): string => `/api/${segments.map(encodeURIComponent).join('/')}`;

export function createApi(bridge: Pick<MorrowbotBridge, 'request'>): Api {
  async function call<T>(schema: z.ZodType<T>, method: ApiMethod, path: string, body?: unknown): Promise<ApiResult<T>> {
    let reply;
    try {
      reply = await bridge.request(method, path, body);
    } catch (error) {
      return internal(0, error instanceof Error ? error.message : 'The request did not reach the host');
    }
    if (reply.status >= 200 && reply.status < 300) {
      const parsed = lenient(schema).safeParse(reply.body);
      return parsed.success ? { kind: 'ok', value: parsed.data } : internal(reply.status, 'The host sent a reply this window does not understand');
    }
    const refused = ApiErrorReply.safeParse(reply.body);
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
    listAllThreads: () => call(ThreadSummaryList, 'GET', at('threads')),
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
    cancelQueued: (threadId, queuedId) => call(NoContent, 'DELETE', at('threads', threadId, 'queue', queuedId)),
    steerQueued: (threadId, queuedId) => call(NoContent, 'POST', at('threads', threadId, 'queue', queuedId, 'steer')),
    answerApproval: (threadId, approvalId, generationId, choiceId) =>
      call(NoContent, 'POST', at('threads', threadId, 'approvals', approvalId), { generationId, choiceId }),
    setReaction: (threadId, request) => call(SetReactionResponse, 'PUT', at('threads', threadId, 'reactions'), request),
    chatSettings: () => call(ChatSettings, 'GET', at('settings', 'chat')),
    saveChatSettings: (settings) => call(ChatSettings, 'PUT', at('settings', 'chat'), settings),
    listPlugins: () => call(PluginList, 'GET', at('plugins')),
    setPluginEnabled: (id, enabled) => call(PluginEntry, 'PUT', at('plugins', id, 'enabled'), { enabled }),
    setPluginConfig: (id, config) => call(PluginEntry, 'PUT', at('plugins', id, 'config'), { config }),
    restartPlugin: (id) => call(PluginEntry, 'POST', at('plugins', id, 'restart')),
    rescanPlugins: () => call(PluginList, 'POST', at('plugins', 'rescan')),
    listConnectors: () => call(ConnectorList, 'GET', at('connectors')),
    createConnector: (request) => call(Connector, 'POST', at('connectors'), request),
    updateConnectorAccount: (id, request) => call(Connector, 'PUT', at('connectors', id, 'account'), request),
    setConnectorEnabled: (id, enabled) => call(Connector, 'PUT', at('connectors', id, 'enabled'), { enabled }),
    setConnectorScope: (id, request) => call(Connector, 'PUT', at('connectors', id, 'scope'), request),
    connectConnector: (id) => call(Connector, 'POST', at('connectors', id, 'connect')),
    disconnectConnector: (id) => call(Connector, 'POST', at('connectors', id, 'disconnect')),
    removeConnector: (id) => call(NoContent, 'DELETE', at('connectors', id)),
    providerInfo: (id, refresh) => call(ProviderInfoResponse, 'GET', `${at('plugins', id, 'info')}${refresh ? '?refresh=1' : ''}`),
    recheck: (id) => call(ProviderInfoResponse, 'POST', at('plugins', id, 'recheck')),
    usage: (id, refresh) => call(UsageResponse, 'GET', `${at('plugins', id, 'usage')}${refresh ? '?refresh=1' : ''}`),
    tokenUsage: (range) => call(TokenUsageResponse, 'GET', `${at('usage', 'tokens')}?range=${range}`),
    releaseGroup: (regId) => call(ReleaseGroupResponse, 'POST', at('child-groups', regId, 'release')),
    listRoutines: (agentId) => call(RoutineList, 'GET', `${at('routines')}?agentId=${encodeURIComponent(agentId)}`),
    createRoutine: (request) => call(Routine, 'POST', at('routines'), request),
    updateRoutine: (id, request) => call(Routine, 'PATCH', at('routines', id), request),
    deleteRoutine: (id) => call(NoContent, 'DELETE', at('routines', id)),
    runRoutine: (id) => call(RunRoutineResponse, 'POST', at('routines', id, 'run'), {}),
    createPairingCode: (url) => call(PairingCodeResponse, 'POST', at('pairing', 'codes'), url === null ? {} : { url }),
    listDevices: () => call(PairedDeviceList, 'GET', at('pairing', 'devices')),
    unpairDevice: (id) => call(NoContent, 'DELETE', at('pairing', 'devices', id)),
    whoAmI: () => call(WhoAmI, 'GET', at('me')),
    createInvite: (request) => call(InviteResponse, 'POST', at('members', 'invites'), request),
    listMembers: () => call(MemberList, 'GET', at('members')),
    revokeMember: (id) => call(NoContent, 'DELETE', at('members', id)),
    listVault: () => call(VaultItemList, 'GET', at('vault')),
    createVaultItem: (request) => call(VaultItem, 'POST', at('vault'), request),
    updateVaultItem: (id, request) => call(VaultItem, 'PATCH', at('vault', id), request),
    deleteVaultItem: (id) => call(NoContent, 'DELETE', at('vault', id)),
  };
}

function internal(status: number, message: string): ApiFailure {
  return { kind: 'failed', status, error: { kind: 'internal', message } };
}
