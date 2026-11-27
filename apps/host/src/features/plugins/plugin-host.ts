import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { PluginManifest, PluginStatus, PluginStatusEvent } from '@morrowbot/contracts';
import { ChildGroupRegistry, type ChildGroupClock, type ChildGroupStore, type ReleaseResult } from './child-groups.ts';
import { discoverPlugins, type DiscoveredPlugin } from './discovery.ts';
import { pluginEnv } from './plugin-env.ts';
import { PluginRequestError, spawnPluginProcess, type PluginProcess, type PluginTimeouts } from './plugin-process.ts';
import type { PluginRecord, PluginStore } from './plugin-store.ts';
import { providerRequests, type ProviderRequests } from './provider-requests.ts';
import { systemProbe, type ProcessProbe } from './release-probe.ts';
import { resolvePluginConfig, type ConfigResult } from './settings.ts';
import type { Slot } from './slot.ts';

export const DEFAULT_PLUGIN_TIMEOUTS: PluginTimeouts = {
  initMs: 10_000,
  healthMs: 5_000,
  shutdownMs: 3_000,
  firstInfoMs: 120_000,
  infoMs: 30_000,
  usageMs: 15_000,
  routeInfoMs: 15_000,
  turnStopMs: 5_000,
};
const HEALTH_INTERVAL_MS = 5 * 60_000;

export interface PluginHostOptions {
  readonly pluginsDir: string;
  readonly store: PluginStore;
  /** Each plugin gets its own folder `<dataDir>/<plugin id>`. */
  readonly dataDir: string;
  /** Starts no plugin processes. Enable and config changes are still saved for the next normal start. */
  readonly safeMode: boolean;
  /** Where process groups are recorded until they are confirmed gone. */
  readonly groups: ChildGroupStore;
  /** The `PATH` plugins (and the CLIs they run) get. */
  readonly pluginPath: string;
  /** Hears every status change, including the ones during startup. */
  readonly onStatus?: (event: PluginStatusEvent) => void;
  readonly timeouts?: PluginTimeouts;
  readonly probe?: ProcessProbe;
  readonly clock?: ChildGroupClock;
  readonly newId?: () => string;
  /** Windows provider plugins are disabled in v1; tests may pretend to be another platform. */
  readonly platform?: NodeJS.Platform;
  readonly log?: (message: string) => void;
}

export interface PluginSummary {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
}

export interface PluginHost extends ProviderRequests {
  /** Plugin folders that could not be loaded, and why. */
  readonly problems: readonly string[];
  readonly groups: ChildGroupRegistry;
  list(): PluginSummary[];
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  /** Saves new settings and restarts the plugin if they are valid; returns the problems otherwise. */
  setConfig(pluginId: string, input: unknown): Promise<ConfigResult>;
  checkHealth(pluginId: string): Promise<PluginStatus>;
  /** Release anyway (after 60 s blocked), then the normal unblock, un-quarantine and restart path. */
  releaseGroup(regId: string): ReleaseResult;
  /** Stops every plugin process. The host refuses further changes afterwards. */
  stop(): Promise<void>;
}

/** Discovers plugins and starts each enabled one in its own process (none in safe mode). */
export async function startPluginHost(options: PluginHostOptions): Promise<PluginHost> {
  const { store, safeMode } = options;
  const timeouts = options.timeouts ?? DEFAULT_PLUGIN_TIMEOUTS;
  const log =
    options.log ??
    ((message: string) => {
      console.error(`MorrowBot host: ${message}`);
    });
  const platform = options.platform ?? process.platform;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const groups = new ChildGroupRegistry({
    store: options.groups,
    probe: options.probe ?? systemProbe,
    clock: options.clock ?? { now: () => new Date().toISOString(), monotonic: () => performance.now() },
    newRegId: newId,
    log,
  });
  await groups.recover();
  const discovery = await discoverPlugins(options.pluginsDir);
  const slots = new Map<string, Slot>();
  let stopping: Promise<void> | undefined;
  let workers = 0;
  for (const plugin of discovery.plugins) {
    const status: PluginStatus = safeMode ? { kind: 'safe-mode' } : { kind: 'stopped' };
    slots.set(plugin.manifest.id, {
      plugin,
      status,
      process: undefined,
      worker: null,
      configRevision: 0,
      queue: Promise.resolve(),
      health: undefined,
      quarantine: undefined,
      info: undefined,
      turns: new Map(),
      restartAfterExit: false,
    });
  }

  function slotOf(pluginId: string): Slot {
    const slot = slots.get(pluginId);
    if (slot === undefined) throw new Error(`Unknown plugin "${pluginId}"`);
    return slot;
  }

  function statusOf(slot: Slot): PluginStatus {
    return slot.quarantine === undefined ? slot.status : { kind: 'quarantined', detail: slot.quarantine };
  }

  function announce(slot: Slot, before: PluginStatus): void {
    const after = statusOf(slot);
    if (isDeepStrictEqual(before, after)) return;
    try {
      options.onStatus?.({ pluginId: slot.plugin.manifest.id, status: after });
    } catch (error) {
      log(`a plugin status listener threw: ${String(error)}`);
    }
  }

  function setStatus(slot: Slot, status: PluginStatus): void {
    const before = statusOf(slot);
    slot.status = status;
    announce(slot, before);
  }

  function quarantine(slot: Slot, pgids: readonly number[]): void {
    const before = statusOf(slot);
    slot.quarantine = `Cleanup failed: process group ${pgids.join(', ')} is still running`;
    announce(slot, before);
  }

  function enqueue(slot: Slot, task: () => Promise<void>): Promise<void> {
    const run = slot.queue.then(() => {
      if (stopping !== undefined) throw new Error('The plugin host has stopped');
      return task();
    });
    slot.queue = run.catch(() => undefined);
    return run;
  }

  /** After a worker is gone: confirm its groups are gone (up to 2 s), then settle its open turns as interrupted. */
  async function workerGone(slot: Slot, child: PluginProcess, worker: number): Promise<boolean> {
    const pluginId = slot.plugin.manifest.id;
    const blocked = await groups.verifyWorker(pluginId, worker);
    for (const [turnId, turn] of slot.turns) {
      if (turn.worker !== worker) continue;
      slot.turns.delete(turnId);
      child.forgetTurn(turnId);
      turn.sink.onLost();
    }
    if (blocked.length > 0) quarantine(slot, blocked.map((row) => row.pgid));
    return blocked.length === 0;
  }

  async function start(slot: Slot, record: PluginRecord | undefined): Promise<void> {
    const { manifest, entryPath, dir } = slot.plugin;
    if (record?.enabled === false) {
      setStatus(slot, { kind: 'disabled' });
      return;
    }
    if (manifest.kind === 'provider' && platform === 'win32') {
      setStatus(slot, { kind: 'unsupported', reason: 'Provider plugins need macOS or Linux in this version of MorrowBot.' });
      return;
    }
    if (slot.quarantine !== undefined) return;
    const resolved = resolvePluginConfig(manifest.settingsSchema, record?.config ?? {});
    if (resolved.kind === 'invalid') {
      setStatus(slot, { kind: 'invalid-config', problems: [...resolved.problems] });
      return;
    }
    setStatus(slot, { kind: 'starting' });
    const dataDir = path.join(options.dataDir, manifest.id);
    const worker = ++workers;
    let child: PluginProcess;
    try {
      await mkdir(dataDir, { recursive: true });
      child = spawnPluginProcess({
        entryPath,
        cwd: dir,
        env: pluginEnv(manifest.envPreset, options.pluginPath),
        timeouts,
        log: (message) => {
          log(`plugin ${manifest.id}: ${message}`);
        },
        groups: {
          started: ({ pgid, leaderStart, scope }) => {
            groups.register(manifest.id, worker, pgid, leaderStart, scope);
            child.ackChildGroup(pgid);
          },
          exited: (pgid) => {
            const row = groups.row(pgid);
            void groups.verify(pgid).then((released) => {
              if (released || row === undefined) return;
              for (const turnId of row.generationIds) {
                const turn = slot.turns.get(turnId);
                if (turn?.worker !== worker || !child.forgetTurn(turnId)) continue;
                slot.turns.delete(turnId);
                turn.sink.onLost();
              }
              quarantine(slot, [pgid]);
            });
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(slot, { kind: 'crashed', reason: { kind: 'spawn-error', message } });
      return;
    }
    slot.process = child;
    slot.worker = worker;
    slot.info = undefined;
    void child.exited.then(async (exit) => {
      const current = slot.process === child;
      if (current) {
        slot.process = undefined;
        slot.info = undefined;
      }
      const clean = await workerGone(slot, child, worker);
      if (!current) return;
      const restart = slot.restartAfterExit;
      slot.restartAfterExit = false;
      if (restart) {
        setStatus(slot, { kind: 'stopped' });
        if (clean && stopping === undefined && !safeMode) void enqueue(slot, async () => start(slot, await store.read(manifest.id)));
        return;
      }
      switch (exit.kind) {
        case 'expected':
          return;
        case 'crashed':
          setStatus(slot, { kind: 'crashed', reason: exit.reason });
          return;
      }
    });
    try {
      const kind = await child.init(resolved.config, dataDir);
      if (kind === manifest.kind) {
        setStatus(slot, { kind: 'running' });
        return;
      }
      await stopFailed(slot, `manifest.json says "${manifest.kind}" but the plugin runs as "${kind}"`);
    } catch (error) {
      if (error instanceof PluginRequestError) await stopFailed(slot, error.message);
      else await child.exited;
    }
  }

  async function stopProcess(slot: Slot): Promise<void> {
    const child = slot.process;
    slot.process = undefined;
    slot.info = undefined;
    await child?.stop();
  }

  async function stopFailed(slot: Slot, message: string): Promise<void> {
    await stopProcess(slot);
    setStatus(slot, { kind: 'crashed', reason: { kind: 'init-error', message } });
  }

  function checkHealth(slot: Slot): Promise<PluginStatus> {
    slot.health ??= probeHealth(slot).finally(() => {
      slot.health = undefined;
    });
    return slot.health;
  }

  /** A health timeout or error marks the plugin unhealthy; it never waits for the process to exit. */
  async function probeHealth(slot: Slot): Promise<PluginStatus> {
    const child = slot.process;
    if (child === undefined || !isServing(slot.status)) return statusOf(slot);
    try {
      const health = await child.health();
      if (slot.process !== child) return statusOf(slot);
      switch (health.kind) {
        case 'ok':
          setStatus(slot, { kind: 'running' });
          break;
        case 'degraded':
          setStatus(slot, { kind: 'unhealthy', detail: health.detail });
          break;
      }
    } catch (error) {
      if (slot.process === child) setStatus(slot, { kind: 'unhealthy', detail: error instanceof Error ? error.message : String(error) });
    }
    return statusOf(slot);
  }

  groups.onReleased((row) => {
    const slot = slots.get(row.pluginId);
    if (slot?.quarantine === undefined || groups.blockedRows(row.pluginId).length > 0) return;
    const before = statusOf(slot);
    slot.quarantine = undefined;
    announce(slot, before);
    if (slot.process === undefined && stopping === undefined && !safeMode) {
      void enqueue(slot, async () => start(slot, await store.read(row.pluginId)));
    }
  });

  function stopAll(): Promise<void> {
    clearInterval(healthTimer);
    groups.close();
    stopping ??= Promise.all(
      [...slots.values()].map(async (slot) => {
        await slot.queue;
        await stopProcess(slot);
        setStatus(slot, { kind: 'stopped' });
      }),
    ).then(() => undefined);
    return stopping;
  }

  const healthTimer = setInterval(() => {
    for (const slot of slots.values()) void checkHealth(slot);
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref();

  if (!safeMode) {
    const boots = await Promise.allSettled(
      [...slots.values()].map((slot) =>
        enqueue(slot, async () => {
          await start(slot, await store.read(slot.plugin.manifest.id));
        }),
      ),
    );
    const failed = boots.find((boot) => boot.status === 'rejected');
    if (failed !== undefined) {
      await stopAll();
      throw failed.reason;
    }
  }

  const requests = providerRequests({ slotOf, statusOf, isServing: (slot) => slot.quarantine === undefined && isServing(slot.status), groups, timeouts });

  return {
    ...requests,
    problems: discovery.problems,
    groups,
    list: () => [...slots.values()].map((slot) => ({ manifest: slot.plugin.manifest, status: statusOf(slot) })),
    setEnabled: (pluginId, enabled) => {
      const slot = slotOf(pluginId);
      return enqueue(slot, async () => {
        const record = await store.read(pluginId);
        const next: PluginRecord = { enabled, config: record?.config ?? {} };
        await store.write(pluginId, next);
        slot.configRevision += 1;
        if (safeMode) return;
        if (!enabled) {
          await stopProcess(slot);
          setStatus(slot, { kind: 'disabled' });
        } else if (slot.process === undefined) {
          await start(slot, next);
        }
      });
    },
    setConfig: async (pluginId, input) => {
      const slot = slotOf(pluginId);
      const resolved = resolvePluginConfig(slot.plugin.manifest.settingsSchema, input);
      if (resolved.kind === 'invalid') return resolved;
      await enqueue(slot, async () => {
        const record = await store.read(pluginId);
        const next: PluginRecord = { enabled: record?.enabled ?? true, config: resolved.saved };
        await store.write(pluginId, next);
        slot.configRevision += 1;
        if (safeMode || !next.enabled) return;
        await stopProcess(slot);
        await start(slot, next);
      });
      return resolved;
    },
    checkHealth: (pluginId) => checkHealth(slotOf(pluginId)),
    releaseGroup: (regId) => groups.releaseAnyway(regId),
    stop: stopAll,
  };
}

export type { DiscoveredPlugin };

function isServing(status: PluginStatus): boolean {
  return status.kind === 'running' || status.kind === 'unhealthy';
}
