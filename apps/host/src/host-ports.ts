import { SendAgentMessageRequest } from '@morrowbot/contracts';
import type { AgentMessageService, SendRefusal } from './features/agent-messages/index.ts';
import type { RoutineToolsPort, T3WatchToolsPort, ToolPorts } from './features/agent-tools/index.ts';
import type { ChatService, createChatService, ProviderPlugins } from './features/chat/index.ts';
import type { ConnectorService } from './features/connectors/index.ts';
import type { MemoryService } from './features/memories/index.ts';
import type { PluginHost } from './features/plugins/index.ts';
import type { RoutineService } from './features/routines/index.ts';
import type { Storage } from './features/storage/index.ts';
import { createSubagentService, type SubagentService } from './features/subagents/index.ts';
import type { T3BatchRecord, T3WatchClock, T3WatchService } from './features/t3-watch/index.ts';

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

/** What the agent tools act on: agents, agent-messages, memories, the turn's chat, the vault's names, routines, T3 watches, sub-agents, connectors and enabled tool plugins. */
export function agentToolPorts(options: {
  readonly storage: Storage;
  readonly agents: ToolPorts['agents'];
  readonly agentMessages: AgentMessageService;
  readonly memories: MemoryService;
  readonly replies: ToolPorts['replies'];
  readonly vault: ToolPorts['vault'];
  readonly subagents: SubagentService;
  readonly connectors: ConnectorService;
  readonly plugins: PluginHost;
  readonly routines: RoutineService;
  readonly t3Watches: T3WatchService;
  readonly t3Clock: Pick<T3WatchClock, 'now'>;
  readonly defaultT3RoutineId: string | null;
  readonly isPluginAllowedForAgent?: (agentId: string, pluginId: string) => boolean;
}): ToolPorts {
  const { storage, agents, agentMessages, memories, replies, vault, subagents, connectors, plugins, routines, t3Watches, t3Clock, defaultT3RoutineId, isPluginAllowedForAgent } =
    options;
  const sharedWithMembers = (agentId: string): boolean => storage.members.allowlistsOf(agentId).length > 0;
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
    replies,
    vault,
    routines: routineToolPort(storage, routines, sharedWithMembers),
    t3Watches: t3WatchToolPort(storage, t3Watches, t3Clock, defaultT3RoutineId, sharedWithMembers),
    subagents: {
      isSubagent: (threadId) => storage.subagents.get(threadId) !== undefined,
      spawn: (grant, input) => subagents.spawn(grant, input),
      wait: (grant, runIds, timeoutMs) => subagents.wait(grant, runIds, timeoutMs),
      list: (grant) => subagents.list(grant),
    },
    connectors: { tools: (agentId) => connectors.toolsFor(agentId), call: (agentId, name, args, signal) => connectors.call(agentId, name, args, signal) },
    pluginTools: {
      list: () => plugins.listPluginTools(),
      ...(isPluginAllowedForAgent === undefined ? {} : { isAllowedForAgent: isPluginAllowedForAgent }),
      call: (request) => plugins.callPluginTool(request),
    },
  };
}

function routineToolPort(storage: Storage, routines: RoutineService, sharedWithMembers: (agentId: string) => boolean): RoutineToolsPort {
  return {
    sharedWithMembers,
    list: (agentId) => (storage.agents.get(agentId) === undefined ? undefined : routines.list(agentId)),
    create: (request) => routines.create(request),
    update: (agentId, routineId, request) =>
      storage.routines.get(routineId)?.agentId === agentId ? routines.update(routineId, request) : { kind: 'not-found' },
    delete: (agentId, routineId) => (storage.routines.get(routineId)?.agentId === agentId ? routines.delete(routineId) : false),
    markNoUpdate: (agentId, threadId) => routines.markNoUpdate(agentId, threadId),
  };
}

type WatchOwnership =
  | { readonly kind: 'owned'; readonly agentId: string }
  | { readonly kind: 'orphaned' }
  | { readonly kind: 'unbound' };

function t3WatchToolPort(
  storage: Storage,
  t3Watches: T3WatchService,
  t3Clock: Pick<T3WatchClock, 'now'>,
  defaultT3RoutineId: string | null,
  sharedWithMembers: (agentId: string) => boolean,
): T3WatchToolsPort {
  const ownershipOfRoutine = (routineId: string | null): WatchOwnership => {
    if (routineId === null) return { kind: 'unbound' };
    const routine = storage.routines.get(routineId);
    return routine === undefined ? { kind: 'orphaned' } : { kind: 'owned', agentId: routine.agentId };
  };
  const watchOwner = (watchId: string): WatchOwnership => ownershipOfRoutine(t3Watches.routineOf(watchId) ?? defaultT3RoutineId);
  const visibleTo = (owner: WatchOwnership, agentId: string): boolean => {
    switch (owner.kind) {
      case 'owned':
        return owner.agentId === agentId;
      case 'unbound':
        return true;
      case 'orphaned':
        return false;
    }
  };
  const batchVisibleTo = (batch: T3BatchRecord, agentId: string): boolean => {
    const watchEvents = batch.entries.filter((entry) => entry.event.scope === 'watch');
    if (watchEvents.length === 0) return visibleTo(ownershipOfRoutine(defaultT3RoutineId), agentId);
    return watchEvents.every(({ event }) => event.scope === 'watch' && visibleTo(watchOwner(event.watchId), agentId));
  };
  return {
    sharedWithMembers,
    list: (agentId, includeSettled) => {
      const watches = t3Watches
        .list()
        .filter((watch) => visibleTo(watchOwner(watch.watchId), agentId))
        .filter((watch) => includeSettled || (watch.settledAt === null && watch.state !== 'superseded'))
        .map((watch) => ({ ...watch, routineId: t3Watches.routineOf(watch.watchId) }));
      const open = t3Watches.openBatch();
      const pendingBatches =
        open !== undefined && batchVisibleTo(open, agentId)
          ? [{ batchId: open.batchId, createdAt: open.createdAt, attempts: open.attempts, resendAt: open.resendAt, events: open.entries }]
          : [];
      const pendingEvents = t3Watches
        .pending()
        .filter((event) =>
          event.scope === 'watch' ? visibleTo(watchOwner(event.watchId), agentId) : visibleTo(ownershipOfRoutine(defaultT3RoutineId), agentId),
        );
      return { watches, pendingBatches, pendingEvents };
    },
    watch: (agentId, request) => {
      if (storage.routines.get(request.routineId)?.agentId !== agentId) {
        return { kind: 'refused', reason: `You have no routine ${request.routineId}` };
      }
      const conflict = storage.t3Watches.unsettled(request.threadId).some((existing) => !visibleTo(watchOwner(existing.watchId), agentId));
      if (conflict) return { kind: 'refused', reason: `Thread ${request.threadId} is already watched by another agent.` };
      const watch = t3Watches.register(
        {
          threadId: request.threadId,
          launchedAt: request.launchedAt ?? new Date(t3Clock.now()).toISOString(),
          exclusive: request.exclusive,
          ...(request.runId === undefined ? {} : { runId: request.runId }),
          ...(request.priorRunId === undefined ? {} : { priorRunId: request.priorRunId }),
          ...(request.label === undefined ? {} : { label: request.label }),
          ...(request.stallAfterMin === undefined ? {} : { stallAfterMin: request.stallAfterMin }),
        },
        request.routineId,
      );
      return { kind: 'watched', watch: { ...watch, routineId: request.routineId } };
    },
    unwatch: (agentId, target) => {
      if (target.watchId !== undefined) {
        const existing = storage.t3Watches.get(target.watchId);
        if (
          existing === undefined ||
          (target.threadId !== undefined && existing.threadId !== target.threadId) ||
          !visibleTo(watchOwner(existing.watchId), agentId)
        ) {
          return { kind: 'not-found' };
        }
        return t3Watches.remove(existing.watchId)
          ? { kind: 'unwatched', threadId: existing.threadId, removedWatchIds: [existing.watchId] }
          : { kind: 'not-found' };
      }
      if (target.threadId === undefined) return { kind: 'not-found' };
      const matches = t3Watches.list().filter((each) => each.threadId === target.threadId && visibleTo(watchOwner(each.watchId), agentId));
      const removedWatchIds = matches.filter((each) => t3Watches.remove(each.watchId)).map((each) => each.watchId);
      return removedWatchIds.length === 0 ? { kind: 'not-found' } : { kind: 'unwatched', threadId: target.threadId, removedWatchIds };
    },
    ack: (agentId, ack) => {
      const batch = t3Watches.getBatch(ack.batchId);
      if (batch === undefined || !batchVisibleTo(batch, agentId)) return { kind: 'unknown_batch' };
      return t3Watches.ack(ack);
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
    reactions: storage.reactions,
    settings: storage.chatSettings,
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

/** Sub-agents of the chat service's turns: their records in storage, on any provider plugin that is loaded. */
export function subagentService(storage: Storage, chat: ChatService, plugins: PluginHost, newId: () => string, now: () => string): SubagentService {
  return createSubagentService({
    chat: {
      parentTurn: (generationId) => chat.parentTurn(generationId),
      start: (threadId, text) => chat.startSubagent(threadId, text),
      run: (threadId) => chat.subagent(threadId),
      runs: (parentThreadId) => chat.subagents(parentThreadId),
      subscribe: (listener) => chat.subscribe(listener),
    },
    records: {
      insert: (thread, record) => {
        storage.transaction(() => {
          storage.subagents.insert(thread, record);
        });
      },
      isSubagent: (threadId) => storage.subagents.get(threadId) !== undefined,
      deleteThread: (threadId) => {
        storage.threads.delete(threadId);
      },
    },
    providers: {
      ids: () => plugins.list().flatMap(({ manifest }) => (manifest.kind === 'provider' ? [manifest.id] : [])),
      info: async (pluginId) => {
        const result = await plugins.info(pluginId, false);
        return result.kind === 'ok' ? result.info : undefined;
      },
    },
    newId,
    now,
  });
}
