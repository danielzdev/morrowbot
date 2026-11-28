import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { SendAgentMessageRequest, type PluginStatusEvent } from '@morrowbot/contracts';
import { createAgentMessageService, type SendRefusal } from './features/agent-messages/index.ts';
import { createAgentService, createFolderService } from './features/agents/index.ts';
import { startApiServer } from './features/api/index.ts';
import { createAttachmentService, type AttachmentService } from './features/attachments/index.ts';
import { createChatService, type ProviderPlugins } from './features/chat/index.ts';
import type { HostConfig } from './features/config/index.ts';
import { healthListener } from './features/health/index.ts';
import { createMemoryService, type MemoryService } from './features/memories/index.ts';
import { createPairingService } from './features/pairing/index.ts';
import {
  resolvePluginPath,
  startPluginHost,
  type ChildGroupClock,
  type PluginHost,
  type PluginTimeouts,
  type ProcessProbe,
} from './features/plugins/index.ts';
import { builtinProviders } from './features/providers/index.ts';
import { findSkills, skillList } from './features/skills/index.ts';
import { createRoutineService, type RoutineClock } from './features/routines/index.ts';
import { lockDataDir, openStorage, type Storage } from './features/storage/index.ts';

export { DataDirLockedError as HostLockedError } from './features/storage/index.ts';

export interface HostOptions {
  readonly config: HostConfig;
  readonly version: string;
  readonly onPluginStatus: (event: PluginStatusEvent) => void;
  readonly newId: () => string;
  readonly now: () => string;
  readonly report: (error: unknown) => void;
  /** Aborts startup; once started, the caller closes the host. */
  readonly signal?: AbortSignal;
  /** The `PATH` plugins get. Resolved from the login shell when left out. */
  readonly pluginPath?: string;
  readonly timeouts?: PluginTimeouts;
  readonly probe?: ProcessProbe;
  readonly clock?: ChildGroupClock;
  /** The OS the host and its built-in providers act on (tests may pretend). */
  readonly platform?: NodeJS.Platform;
  /** The name paired devices show for this host. Defaults to the computer's name. */
  readonly hostName?: string;
  /** Real time and the timer for routine schedules. Defaults to the system clock. */
  readonly routineClock?: RoutineClock;
}

export interface Host {
  readonly url: string;
  /** This launch's API token. It lives only in memory and is never logged. */
  readonly token: string;
  readonly plugins: PluginHost;
  close(): Promise<void>;
}

/**
 * Takes the data folder's lock, opens storage, starts the built-in providers and the plugins, and serves the local API.
 * Closing stops active turns (saving their replies), then the plugins, then storage, then the lock.
 */
export async function startHost(options: HostOptions): Promise<Host> {
  const { config, newId, now, report } = options;
  await mkdir(config.dataDir, { recursive: true });
  const dataDir = await realpath(config.dataDir);
  options.signal?.throwIfAborted();
  const lock = lockDataDir(path.join(dataDir, 'host.lock.db'), dataDir);
  const undo: (() => Promise<void> | void)[] = [
    () => {
      lock.release();
    },
  ];
  const unwind = async (): Promise<void> => {
    for (const step of undo.reverse()) await step();
  };
  try {
    const storage = openStorage(path.join(dataDir, 'morrowbot.sqlite'), now);
    undo.push(() => {
      storage.close();
    });
    const pluginPath = options.pluginPath ?? (await resolvePluginPath());
    options.signal?.throwIfAborted();
    const platform = options.platform ?? process.platform;
    const plugins = await startPluginHost({
      pluginsDir: config.pluginsDir,
      builtinPluginsDir: config.builtinPluginsDir,
      builtins: builtinProviders(platform),
      safeMode: config.safeMode,
      dataDir: path.join(dataDir, 'plugin-data'),
      store: storage.plugins,
      groups: {
        insert: (row) => {
          storage.childGroups.insert(row);
        },
        delete: (pgid) => {
          storage.childGroups.delete(pgid);
        },
        link: (pgid, generationId) => {
          storage.childGroups.link(pgid, generationId);
        },
        unlink: (pgid, generationId) => {
          storage.childGroups.unlink(pgid, generationId);
        },
        list: () => storage.childGroups.list(),
        transaction: (work) => storage.transaction(work),
      },
      pluginPath,
      onStatus: options.onPluginStatus,
      ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
      ...(options.probe === undefined ? {} : { probe: options.probe }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      platform,
      newId: randomUUID,
    });
    undo.push(() => plugins.stop());
    options.signal?.throwIfAborted();
    const folders = createFolderService({ records: storage.folders, newId, now });
    const agents = createAgentService({
      records: storage.agents,
      folderExists: (id) => folders.get(id) !== undefined,
      workspacesDir: path.join(dataDir, 'workspaces'),
      draftsDir: path.join(dataDir, 'instructions-drafts'),
      newId,
      now,
    });
    const attachments = createAttachmentService({
      dir: path.join(dataDir, 'attachments'),
      records: storage.attachments,
      threadExists: (id) => storage.threads.get(id) !== undefined,
      newId,
      now,
    });
    await attachments.sweep();
    const memories = createMemoryService({ records: storage.memories, agentExists: (id) => agents.get(id) !== undefined, newId, now });
    const skillsDir = path.join(dataDir, 'skills');
    const agentMessages = createAgentMessageService({
      records: storage.agentMessages,
      agentExists: (id) => agents.get(id) !== undefined,
      threads: storage.threads,
      newId,
      now,
    });
    const chat = createChatService({
      store: chatStore(storage),
      agents,
      inbox: {
        waiting: (threadId) => storage.agentMessages.waiting(threadId),
        reply: (message, text) => {
          const request = SendAgentMessageRequest.safeParse({ kind: 'reply', replyToMessageId: message.id, text, expectsReply: false });
          if (!request.success) return { kind: 'refused', reason: request.error.issues.map((issue) => issue.message).join('; ') };
          const sent = agentMessages.send(message.to.agentId, request.data);
          return sent.kind === 'sent' ? { kind: 'sent' } : { kind: 'refused', reason: refusalReason(sent) };
        },
      },
      context: turnContext(skillsDir, memories, attachments),
      plugins: providerPlugins(plugins),
      newId,
      now,
      hostEpoch: randomUUID(),
      report,
    });
    undo.push(() => chat.close());
    const stopReading = agentMessages.subscribe((message) => {
      chat.readAgentMessages(message.to.threadId);
    });
    undo.push(() => {
      stopReading();
    });
    chat.readAgentMessages(null);
    const routines = createRoutineService({
      store: { routines: storage.routines, runs: storage.routineRuns, waits: storage.waits, transaction: (work) => storage.transaction(work) },
      chat: {
        agentExists: (id) => agents.get(id) !== undefined,
        createThread: (agentId, request) => chat.createThread(agentId, request),
        send: (threadId, text, choice, mode) => chat.send(threadId, text, [], choice, mode),
        deleteThread: (id) => chat.deleteThread(id),
        subscribe: (listener) => chat.subscribe(listener),
      },
      clock: options.routineClock ?? systemClock,
      newId,
      now,
      report,
    });
    undo.push(() => {
      routines.close();
    });
    routines.tick();
    const token = randomBytes(32).toString('base64url');
    const api = await startApiServer({
      address: { hostname: config.hostname, port: config.port },
      token,
      hostName: options.hostName ?? hostname(),
      hostVersion: options.version,
      services: {
        agents: { ...agents, lastMessages: () => storage.messages.lastByAgent() },
        folders,
        chat: {
          ...chat,
          deleteThread: (id) => afterwards(chat.deleteThread(id), () => attachments.sweep(), report),
          deleteAgent: (id) => afterwards(chat.deleteAgent(id), () => attachments.sweep(), report),
        },
        attachments,
        memories,
        skills: {
          list: async (agentId) => {
            const agent = agents.get(agentId);
            return agent === undefined ? undefined : skillList(await findSkills(skillsDir, agent.workspace.dir));
          },
        },
        usage: { tokens: (range) => storage.tokens.read(range) },
        plugins: {
          list: () => plugins.list(),
          safeMode: plugins.safeMode,
          pluginsDir: config.pluginsDir,
          problems: () => plugins.problems(),
          rescan: () => plugins.rescan(),
          restart: (pluginId) => plugins.restart(pluginId),
          blockedGroups: (pluginId) => plugins.groups.blocked(pluginId),
          saved: (pluginId) => storage.plugins.read(pluginId),
          setEnabled: (pluginId, enabled) => plugins.setEnabled(pluginId, enabled),
          setConfig: (pluginId, input) => plugins.setConfig(pluginId, input),
          info: async (pluginId, refresh) => {
            const result = await plugins.info(pluginId, refresh);
            switch (result.kind) {
              case 'ok':
                return { kind: 'ok', info: result.info };
              case 'superseded':
                return { kind: 'unavailable', reason: 'The provider was rechecked meanwhile. Try again.' };
              case 'unavailable':
                return result;
            }
          },
          releaseGroup: (regId) => plugins.releaseGroup(regId),
        },
        pairing: createPairingService({ records: storage.devices, newId, now }),
        agentMessages,
        routines,
      },
      fallback: healthListener(options.version),
      report,
    });
    return {
      url: api.url,
      token,
      plugins,
      close: async () => {
        await api.close();
        await unwind();
      },
    };
  } catch (error) {
    await unwind();
    throw error;
  }
}

function refusalReason(refusal: SendRefusal): string {
  return refusal.kind === 'not-found' ? `${refusal.what} not found` : refusal.reason;
}

/** Runs `cleanup` once `work` removed something; a failed cleanup is reported, never returned. */
async function afterwards(work: Promise<boolean>, cleanup: () => Promise<void>, report: (error: unknown) => void): Promise<boolean> {
  const removed = await work;
  if (removed) cleanup().catch(report);
  return removed;
}

function turnContext(skillsDir: string, memories: MemoryService, attachments: AttachmentService): Parameters<typeof createChatService>[0]['context'] {
  return {
    prelude: async (agentId, workspaceDir) => {
      const found = await findSkills(skillsDir, workspaceDir);
      return {
        skills: found.skills.map(({ skill, file }) => ({ name: skill.name, description: skill.description, file })),
        memories: memories.essential(agentId),
      };
    },
    readAttachment: (attachment) => attachments.read(attachment),
  };
}
const systemClock: RoutineClock = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms).unref();
    return () => {
      clearInterval(timer);
    };
  },
};

function chatStore(storage: Storage): Parameters<typeof createChatService>[0]['store'] {
  return {
    attachments: storage.attachments,
    threads: storage.threads,
    messages: storage.messages,
    generations: storage.generations,
    sessions: storage.sessions,
    usage: storage.usage,
    heldThreads: () => storage.childGroups.heldThreads(),
    transaction: (work) => storage.transaction(work),
  };
}

function providerPlugins(plugins: PluginHost): ProviderPlugins {
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
