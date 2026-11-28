import { SendAgentMessageRequest } from '@morrowbot/contracts';
import type { AgentMessageService, SendRefusal } from './features/agent-messages/index.ts';
import type { ToolPorts } from './features/agent-tools/index.ts';
import type { createChatService, ProviderPlugins } from './features/chat/index.ts';
import type { ConnectorService } from './features/connectors/index.ts';
import type { MemoryService } from './features/memories/index.ts';
import type { PluginHost } from './features/plugins/index.ts';
import type { Storage } from './features/storage/index.ts';
import type { SubagentService } from './features/subagents/index.ts';

type ChatOptions = Parameters<typeof createChatService>[0];

/**
 * Messages a background turn reads, and its answer sent back as the reply. An agent that already
 * replied during the turn (with the `send_message` tool, perhaps asking a follow-up) sends nothing more.
 */
export function agentInbox(storage: Storage, agentMessages: AgentMessageService): ChatOptions['inbox'] {
  return {
    waiting: (threadId) => storage.agentMessages.waiting(threadId),
    reply: (message, text) => {
      if (storage.agentMessages.hasReply(message.id)) return { kind: 'answered' };
      const request = SendAgentMessageRequest.safeParse({ kind: 'reply', replyToMessageId: message.id, text, expectsReply: false });
      if (!request.success) return { kind: 'refused', reason: request.error.issues.map((issue) => issue.message).join('; ') };
      const sent = agentMessages.send(message.to.agentId, request.data);
      return sent.kind === 'sent' ? { kind: 'sent' } : { kind: 'refused', reason: refusalReason(sent) };
    },
  };
}

/**
 * What the agent tools act on: agents, agent-messages, memories, sub-agents, connectors and enabled tool plugins.
 * The sub-agents service is read when a tool is called: it is made after the chat service, which needs the tools first.
 */
export function agentToolPorts(
  storage: Storage,
  agents: ToolPorts['agents'],
  agentMessages: AgentMessageService,
  memories: MemoryService,
  subagents: () => SubagentService,
  connectors: ConnectorService,
  plugins: PluginHost,
  isPluginAllowedForAgent?: (agentId: string, pluginId: string) => boolean,
): ToolPorts {
  return {
    agents,
    messages: {
      get: (id) => storage.agentMessages.get(id),
      send: (senderId, request) => {
        const sent = agentMessages.send(senderId, request);
        return sent.kind === 'sent' ? sent : { kind: 'refused', reason: refusalReason(sent) };
      },
    },
    memories,
    subagents: {
      isSubagent: (threadId) => storage.subagents.get(threadId) !== undefined,
      spawn: (grant, input) => subagents().spawn(grant, input),
      wait: (grant, runIds, timeoutMs) => subagents().wait(grant, runIds, timeoutMs),
      list: (grant) => subagents().list(grant),
    },
    connectors: { tools: (agentId) => connectors.toolsFor(agentId), call: (agentId, name, args, signal) => connectors.call(agentId, name, args, signal) },
    pluginTools: {
      list: () => plugins.listPluginTools(),
      ...(isPluginAllowedForAgent === undefined ? {} : { isAllowedForAgent: isPluginAllowedForAgent }),
      call: (request) => plugins.callPluginTool(request),
    },
  };
}

function refusalReason(refusal: SendRefusal): string {
  return refusal.kind === 'not-found' ? `${refusal.what} not found` : refusal.reason;
}

export function chatStore(storage: Storage): ChatOptions['store'] {
  return {
    attachments: storage.attachments,
    threads: storage.threads,
    messages: storage.messages,
    queued: storage.queued,
    generations: storage.generations,
    sessions: storage.sessions,
    usage: storage.usage,
    subagents: storage.subagents,
    heldThreads: () => storage.childGroups.heldThreads(),
    transaction: (work) => storage.transaction(work),
  };
}

export function providerPlugins(plugins: PluginHost): ProviderPlugins {
  return {
    isProvider: (pluginId) => plugins.list().some(({ manifest }) => manifest.id === pluginId && manifest.kind === 'provider'),
    revision: (pluginId) => plugins.revision(pluginId),
    info: (pluginId, refresh) => plugins.info(pluginId, refresh),
    cachedInfo: (pluginId) => plugins.cachedInfo(pluginId),
    usage: (pluginId, refresh) => plugins.usage(pluginId, refresh),
    routeInfo: (pluginId, cwd) => plugins.routeInfo(pluginId, cwd),
    startTurn: (pluginId, worker, request, sink) => plugins.startTurn(pluginId, worker, request, sink),
    canStart: (pluginId, worker) => plugins.canStart(pluginId, worker),
    linkDaemon: (pluginId, worker, generationId) => {
      plugins.linkDaemon(pluginId, worker, generationId);
    },
    unlinkDaemon: (generationId) => {
      plugins.unlinkDaemon(generationId);
    },
    recheck: (pluginId) => plugins.recheck(pluginId),
    cancelTurn: (pluginId, turnId) => {
      plugins.cancelTurn(pluginId, turnId);
    },
    steerTurn: (pluginId, turnId, steerId, text) => {
      plugins.steerTurn(pluginId, turnId, steerId, text);
    },
    replyApproval: (pluginId, turnId, approvalId, choiceId) => {
      plugins.replyApproval(pluginId, turnId, approvalId, choiceId);
    },
    holdsGeneration: (generationId) => plugins.groups.groupsOf(new Set([generationId])).length > 0,
    cleaningUp: (generationId) => plugins.groups.groupsOf(new Set([generationId])).some((row) => !plugins.groups.isBlocked(row.pgid)),
    blockedGroups: (generationIds) => {
      const held = new Set(plugins.groups.groupsOf(generationIds).map((row) => row.regId));
      return plugins.groups.blocked().filter((group) => held.has(group.regId));
    },
    onGroupReleased: (listener) =>
      plugins.groups.onReleased((row) => {
        listener(row.generationIds);
      }),
    onGroupBlocked: (listener) =>
      plugins.groups.onBlocked((row) => {
        listener(row.generationIds);
      }),
  };
}
