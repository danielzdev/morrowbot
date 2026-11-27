import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import type { PluginStatusEvent } from '@morrowbot/contracts';
import { createAgentService, createFolderService } from './features/agents/index.ts';
import { startApiServer } from './features/api/index.ts';
import { createChatService, type ProviderPlugins } from './features/chat/index.ts';
import type { HostConfig } from './features/config/index.ts';
import { healthListener } from './features/health/index.ts';
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
    const chat = createChatService({
      store: chatStore(storage),
      agents,
      plugins: providerPlugins(plugins),
      newId,
      now,
      hostEpoch: randomUUID(),
      report,
    });
    undo.push(() => chat.close());
    const token = randomBytes(32).toString('base64url');
    const api = await startApiServer({
      address: { hostname: config.hostname, port: config.port },
      token,
      hostName: options.hostName ?? hostname(),
      hostVersion: options.version,
      services: {
        agents: { ...agents, lastMessages: () => storage.messages.lastByAgent() },
        folders,
        chat,
        usage: { tokens: (range) => storage.tokens.read(range) },
        plugins: {
          list: () => plugins.list(),
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

function chatStore(storage: Storage): Parameters<typeof createChatService>[0]['store'] {
  return {
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
