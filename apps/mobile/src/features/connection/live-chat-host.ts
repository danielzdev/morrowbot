import {
  Agent,
  AgentInstructionsView,
  AgentList,
  ContinueResponse,
  PluginEntry,
  PluginList,
  ProviderInfoResponse,
  SendMessageResponse,
  StopGenerationResponse,
  Thread,
  ThreadList,
  type ContinueRequest,
  type CreateThreadRequest,
  type SendMessageRequest,
  type SetPluginEnabledRequest,
} from '@morrowbot/contracts';
import { z } from 'zod';
import type { ChatHost, ChatResult } from '../../lib/chat-host.ts';
import type { HostRequest, HostResult, HostTransport } from '../../lib/host-connection.ts';

/** A 204 reply has no body. */
const NoContent = z.undefined().transform(() => null);

const UNPAIRED = 'This phone is no longer paired with the host. Pair it again in Settings.';

/** The chat's view of a reply: anything that did not reach the host's answer is status 0. */
function toChat<T>(reply: HostResult<T>): ChatResult<T> {
  switch (reply.kind) {
    case 'ok':
      return reply;
    case 'failed':
      return { kind: 'failed', status: reply.status, error: reply.error };
    case 'unauthorized':
      return { kind: 'failed', status: 401, error: { kind: 'unauthorized', message: UNPAIRED } };
    case 'unreachable':
      return { kind: 'failed', status: 0, error: { kind: 'internal', message: `Could not reach the host. ${reply.message}` } };
    case 'unsupported':
      return { kind: 'failed', status: 0, error: { kind: 'internal', message: 'This host does not offer this yet.' } };
    case 'malformed':
      return { kind: 'failed', status: 0, error: { kind: 'internal', message: 'The host sent something this app cannot read. Update Ori Kami on both devices.' } };
  }
}

const part = encodeURIComponent;

/**
 * The chat and Extensions API of the paired host, over its transport: every reply is parsed with
 * `@morrowbot/contracts`, and `watch` is the transport's fetch-`/state`-then-subscribe watcher.
 */
export function createLiveChatHost(transport: HostTransport): ChatHost {
  const call = async <T>(request: HostRequest<T>): Promise<ChatResult<T>> => toChat(await transport.request(request));
  const pluginListeners = new Set<(entry: PluginEntry) => void>();

  return {
    hostName: transport.host.hostName,
    agents: () => call({ method: 'GET', path: '/api/agents', reply: AgentList }),
    threads: (agentId) => call({ method: 'GET', path: `/api/agents/${part(agentId)}/threads`, reply: ThreadList }),
    createThread: (agentId) => {
      const body: CreateThreadRequest = { title: 'New chat' };
      return call({ method: 'POST', path: `/api/agents/${part(agentId)}/threads`, reply: Thread, body });
    },
    send: (threadId, text) => {
      const body: SendMessageRequest = { text, attachmentIds: [], sessionChoice: { kind: 'auto' } };
      return call({ method: 'POST', path: `/api/threads/${part(threadId)}/messages`, reply: SendMessageResponse, body });
    },
    continueTurn: (threadId, failedMessageId) => {
      const body: ContinueRequest = { failedMessageId, sessionChoice: { kind: 'auto' } };
      return call({ method: 'POST', path: `/api/threads/${part(threadId)}/continue`, reply: ContinueResponse, body });
    },
    stop: (threadId) => call({ method: 'POST', path: `/api/threads/${part(threadId)}/stop`, reply: StopGenerationResponse }),
    answerApproval: (threadId, approvalId, body) =>
      call({ method: 'POST', path: `/api/threads/${part(threadId)}/approvals/${part(approvalId)}`, reply: NoContent, body }),
    providerInfo: (pluginId) => call({ method: 'GET', path: `/api/plugins/${part(pluginId)}/info`, reply: ProviderInfoResponse }),
    updateAgent: (agentId, body) => call({ method: 'PATCH', path: `/api/agents/${part(agentId)}`, reply: Agent, body }),
    deleteAgent: (agentId) => call({ method: 'DELETE', path: `/api/agents/${part(agentId)}`, reply: NoContent }),
    instructions: (agentId) => call({ method: 'GET', path: `/api/agents/${part(agentId)}/instructions`, reply: AgentInstructionsView }),
    plugins: () => call({ method: 'GET', path: '/api/plugins', reply: PluginList }),
    setPluginEnabled: async (pluginId, enabled) => {
      const body: SetPluginEnabledRequest = { enabled };
      const result = await call({ method: 'PUT', path: `/api/plugins/${part(pluginId)}/enabled`, reply: PluginEntry, body });
      if (result.kind === 'ok') for (const listener of [...pluginListeners]) listener(result.value);
      return result;
    },
    onPluginChanged: (listener) => {
      pluginListeners.add(listener);
      return () => {
        pluginListeners.delete(listener);
      };
    },
    watch: (threadId, watcher) => transport.watchThread(threadId, watcher),
  };
}
