import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import type { PluginStatusEvent } from '@morrowbot/contracts';
import { createAgentMessageService } from './features/agent-messages/index.ts';
import { startToolServer, type ToolGrant, type ToolServer } from './features/agent-tools/index.ts';
import { createAgentService, createFolderService } from './features/agents/index.ts';
import { startApiServer } from './features/api/index.ts';
import { createAttachmentService, type AttachmentService } from './features/attachments/index.ts';
import { createChatService, type TurnOutputBudget } from './features/chat/index.ts';
import { createConnectorRuntime, createConnectorService } from './features/connectors/index.ts';
import type { HostConfig } from './features/config/index.ts';
import { healthListener } from './features/health/index.ts';
import { createMemberService } from './features/members/index.ts';
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
import { lockDataDir, openStorage } from './features/storage/index.ts';
import { cliProbe, createT3WatchService, type T3Probe, type T3WatchClock, type T3WatchService } from './features/t3-watch/index.ts';
import { keyValue, loginFill, openVault, vaultBackend, type VaultKeyChoice } from './features/vault/index.ts';
import { DATABASE, providerFence } from './host-fence.ts';
import { agentInbox, agentToolPorts, chatStore, providerPlugins, subagentService } from './host-ports.ts';
import { routineSink } from './t3-routine-sink.ts';

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
  /** What the T3 watcher reads T3 Code with, and its clock. Defaults to the `t3` CLI and the system clock. */
  readonly t3Watch?: { readonly probe: T3Probe; readonly clock: T3WatchClock };
  /** Where the vault's master key lives: the OS keystore (the default), or a file in the data folder (tests). */
  readonly vaultKeys?: VaultKeyChoice;
  /** Hook for per-agent tool plugin scoping (#36). Defaults to allowing all enabled tool plugins. */
  readonly isPluginAllowedForAgent?: (agentId: string, pluginId: string) => boolean;
  /** Per-turn cap on streamed bytes and events; defaults to `DEFAULT_TURN_OUTPUT_BUDGET`. */
  readonly turnOutputBudget?: TurnOutputBudget;
}

export interface Host {
  readonly url: string;
  /** This launch's API token. It lives only in memory and is never logged. */
  readonly token: string;
  readonly plugins: PluginHost;
  readonly t3Watches: Pick<T3WatchService, 'idle'>;
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
    const storage = openStorage(path.join(dataDir, DATABASE), now);
    undo.push(() => {
      storage.close();
    });
    const pluginPath = options.pluginPath ?? (await resolvePluginPath());
    options.signal?.throwIfAborted();
    const platform = options.platform ?? process.platform;
    const backend = await vaultBackend(options.vaultKeys ?? 'system', process.platform, dataDir);
    if (backend.headless !== null) console.warn(`MorrowBot host: the vault key is kept in the data folder because ${backend.headless}`);
    const vault = await openVault({
      file: path.join(dataDir, 'vault.json'),
      secrets: backend.secrets,
      newId,
      now,
      report,
    });
    const plugins = await startPluginHost({
      pluginsDir: config.pluginsDir,
      builtinPluginsDir: config.builtinPluginsDir,
      builtins: builtinProviders(platform, await providerFence(dataDir, config.pluginsDir, process.execPath)),
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
      secrets: (request) => loginFill(vault, request),
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
    const members = createMemberService({ records: storage.members, workspaceOf: (id) => agents.get(id)?.workspace.kind, newId, now });
    const agentMessages = createAgentMessageService({
      records: storage.agentMessages,
      agentExists: (id) => agents.get(id) !== undefined,
      mayMessage: (fromAgentId, toAgentId) => members.mayMessage(fromAgentId, toAgentId),
      accessOf: (id) => {
        const provider = agents.get(id)?.provider;
        return provider?.kind === 'bound' ? provider.access : null;
      },
      threads: storage.threads,
      newId,
      now,
    });
    const connectors = createConnectorService({
      store: storage.connectors,
      runtime: createConnectorRuntime({ path: pluginPath, version: options.version, vault: (vaultId) => keyValue(vault, vaultId) }),
      safeMode: config.safeMode,
      agentExists: (id) => agents.get(id) !== undefined,
      sharedWithMembers: (agentId) => storage.members.allowlistsOf(agentId).length > 0,
      newId,
      now,
      report,
    });
    undo.push(() => connectors.close());
    connectors.start();
    let toolServer: ToolServer | undefined;
    const chat = createChatService({
      store: chatStore(storage),
      agents,
      inbox: agentInbox(storage, agentMessages),
      tools: {
        open: (grant: ToolGrant) => {
          if (toolServer === undefined) throw new Error('The tool server is not running');
          return toolServer.open(grant);
        },
        close: (turnId: string) => {
          toolServer?.close(turnId);
        },
      },
      context: turnContext(skillsDir, memories, attachments),
      plugins: providerPlugins(plugins),
      newId,
      now,
      hostEpoch: randomUUID(),
      report,
      ...(options.turnOutputBudget === undefined ? {} : { turnOutputBudget: options.turnOutputBudget }),
    });
    const subagents = subagentService(storage, chat, plugins, newId, now);
    const routines = createRoutineService({
      store: { routines: storage.routines, runs: storage.routineRuns, waits: storage.waits, transaction: (work) => storage.transaction(work) },
      chat: {
        agentExists: (id) => agents.get(id) !== undefined,
        createThread: (agentId, request) => chat.createThread(agentId, request),
        send: (threadId, text, choice) => chat.sendUnattended(threadId, text, choice),
        deleteThread: (id) => chat.deleteThread(id),
        subscribe: (listener) => chat.subscribe(listener),
      },
      clock: options.routineClock ?? systemClock,
      newId,
      now,
      report,
    });
    const t3Clock = options.t3Watch?.clock ?? systemClock;
    const t3Watches = createT3WatchService({
      store: { watches: storage.t3Watches, outbox: storage.t3Outbox, batches: storage.t3Batches, transaction: (work) => storage.transaction(work) },
      probe: options.t3Watch?.probe ?? cliProbe(config.t3Watch.bin),
      sink: routineSink(routines, config.t3Watch.routineId, (agentId) => chat.agentBusy(agentId)),
      clock: t3Clock,
      dir: config.t3Watch.dir,
      projects: config.t3Watch.projects,
      newId,
      report,
      warn: (message) => {
        console.warn(`MorrowBot host: ${message}`);
      },
    });
    try {
      toolServer = await startToolServer({
        ports: agentToolPorts({
          storage,
          agents,
          agentMessages,
          memories,
          replies: { react: (grant, emoji) => chat.agentReact(grant, emoji), stayQuiet: (grant) => chat.stayQuiet(grant) },
          vault,
          subagents,
          connectors,
          plugins,
          routines,
          t3Watches,
          t3Clock,
          defaultT3RoutineId: config.t3Watch.routineId,
          isPluginAllowedForAgent: (agentId, pluginId) => {
            const agent = agents.get(agentId);
            if (agent === undefined) return false;
            if (agent.disabledExtensions.includes(pluginId)) return false;
            return options.isPluginAllowedForAgent === undefined ? true : options.isPluginAllowedForAgent(agentId, pluginId);
          },
        }),
        version: options.version,
        report,
      });
    } catch (error) {
      t3Watches.close();
      routines.close();
      await chat.close();
      throw error;
    }
    const tools = toolServer;
    undo.push(() => tools.stop());
    undo.push(() => chat.close());
    const stopReading = agentMessages.subscribe((message) => {
      chat.readAgentMessages(message.to.threadId);
    });
    undo.push(() => {
      stopReading();
    });
    undo.push(() => {
      routines.close();
    });
    undo.push(() => {
      t3Watches.close();
    });
    chat.readAgentMessages(null);
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
        attachments: { ...attachments, threadOf: (id) => storage.attachments.threadOf(id) },
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
        connectors,
        pairing: createPairingService({ records: storage.devices, newId, now }),
        members,
        agentMessages,
        routines,
        t3Watches,
        settings: {
          chat: () => storage.chatSettings.get(),
          setChat: (settings) => {
            storage.chatSettings.set(settings);
            return storage.chatSettings.get();
          },
        },
        vault,
      },
      fallback: healthListener(options.version),
      report,
    });
    return {
      url: api.url,
      token,
      plugins,
      t3Watches,
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
