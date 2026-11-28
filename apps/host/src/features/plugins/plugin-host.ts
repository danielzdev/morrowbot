import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { PluginManifest, PluginOrigin, PluginProblem, PluginStatus, PluginStatusEvent } from '@morrowbot/contracts';
import { ChildGroupRegistry, type ChildGroupClock, type ChildGroupStore, type ReleaseResult } from './child-groups.ts';
import { daemons as daemonControl, type RecheckAnswer } from './daemons.ts';
import { readCatalog, type PluginSource } from './discovery.ts';
import { pluginControls, type RestartResult } from './plugin-controls.ts';
import { pluginEnv } from './plugin-env.ts';
import { connectPlugin, PluginRequestError, type PluginProcess, type PluginTimeouts } from './plugin-process.ts';
import type { PluginRecord, PluginStore } from './plugin-store.ts';
import { providerRequests, type ProviderRequests } from './provider-requests.ts';
import { systemProbe, type ProcessProbe } from './release-probe.ts';
import { resolvePluginConfig, type ConfigResult } from './settings.ts';
import { healthCheck } from './health.ts';
import { newSlot, type Slot } from './slot.ts';

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
  /** The user's plugins folder. */
  readonly pluginsDir: string;
  /** The plugins folder that ships inside the app, if any. Its ids win over the user's. */
  readonly builtinPluginsDir: string | null;
  /** Providers built into MorrowBot, served in this process. Listed first; their ids are reserved, and safe mode does not stop them. */
  readonly builtins: readonly PluginSource[];
  readonly store: PluginStore;
  /** Each plugin gets its own folder `<dataDir>/<plugin id>`. */
  readonly dataDir: string;
  /** Starts no plugin processes (built-in providers still run). Enable and config changes are still saved for the next normal start. */
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
  readonly source: PluginOrigin;
  readonly status: PluginStatus;
}

export interface PluginHost extends ProviderRequests {
  readonly safeMode: boolean;
  readonly groups: ChildGroupRegistry;
  /** Plugin folders the last discovery could not load, and why. */
  problems(): readonly PluginProblem[];
  list(): PluginSummary[];
  /** Discovers the plugin folders again: new plugins are added and started; the problems are replaced. */
  rescan(): Promise<void>;
  /** Stops the plugin's worker and starts a fresh one. */
  restart(pluginId: string): Promise<RestartResult>;
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  /** Saves new settings and restarts the plugin if they are valid; returns the problems otherwise. */
  setConfig(pluginId: string, input: unknown): Promise<ConfigResult>;
  checkHealth(pluginId: string): Promise<PluginStatus>;
  /** Release anyway (after 60 s blocked), then the normal unblock, un-quarantine and restart path. */
  releaseGroup(regId: string): ReleaseResult;
  /** Retires the plugin's daemon and starts a fresh one (the caller has checked the plugin has no turns). */
  recheck(pluginId: string): Promise<RecheckAnswer>;
  /** Stops every plugin process. The host refuses further changes afterwards. */
  stop(): Promise<void>;
}

/** Discovers plugins and starts each enabled one in its own process (in safe mode, only the built-in providers). */
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
  const inHost = new Set(options.builtins.map(({ manifest }) => manifest.id));
  const paused = (slot: Slot): boolean => safeMode && !inHost.has(slot.plugin.manifest.id);
  const catalog = () => readCatalog(options.builtins, options.builtinPluginsDir, options.pluginsDir);
  const found = await catalog();
  let problems = found.problems;
  const slots = new Map<string, Slot>();
  let stopping: Promise<void> | undefined;
  let workers = 0;
  /** Adds a slot for each plugin not served yet, and returns the new ones. */
  const addSlots = (plugins: readonly PluginSource[]): Slot[] =>
    plugins.flatMap((plugin) => {
      if (slots.has(plugin.manifest.id)) return [];
      const slot = newSlot(plugin, safeMode && !inHost.has(plugin.manifest.id) ? { kind: 'safe-mode' } : { kind: 'stopped' });
      slots.set(plugin.manifest.id, slot);
      return [slot];
    });
  addSlots(found.plugins);

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
    // Re-read now: a row checked as blocked may have been released while another was still checked.
    const holding = blocked.filter((row) => row.kind !== 'probe' && groups.isBlocked(row.pgid));
    if (holding.length > 0 && stopping === undefined) quarantine(slot, holding.map((row) => row.pgid));
    return holding.length === 0;
  }

  const serving = (slot: Slot): boolean => slot.quarantine === undefined && isServing(slot.status);
  const daemons = daemonControl({
    groups,
    log,
    stopping: () => stopping !== undefined,
    isServing: (slot) => serving(slot),
    quarantine,
    killWorker: (slot, child) => killWorker(slot, child),
  });

  async function start(slot: Slot, record: PluginRecord | undefined): Promise<void> {
    const { manifest, launch } = slot.plugin;
    await slot.retired;
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
      child = connectPlugin(launch(pluginEnv(manifest.envPreset, options.pluginPath)), {
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
            daemons.groupExited(slot, child, worker, pgid);
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
    const retired = child.exited.then(async (exit) => {
      const current = slot.process === child;
      if (current) {
        slot.process = undefined;
        slot.info = undefined;
      }
      return { exit, current, clean: await workerGone(slot, child, worker) };
    });
    slot.retired = retired.then(({ exit, current, clean }) => {
      if (!current) return;
      const restarting = slot.restartAfterExit;
      slot.restartAfterExit = false;
      if (restarting) {
        setStatus(slot, { kind: 'stopped' });
        if (clean && stopping === undefined && !paused(slot)) void restart(slot);
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
      else await slot.retired;
    }
  }

  /** Starts the worker again unless one is already running by the time the queue gets to it. */
  function restart(slot: Slot): Promise<void> {
    return enqueue(slot, async () => {
      if (slot.process === undefined) await start(slot, await store.read(slot.plugin.manifest.id));
    });
  }

  /** Its daemons end with the worker: a turn settling meanwhile keeps its link, so its thread stays held until they are checked. */
  function endDaemons(slot: Slot): void {
    for (const row of groups.daemons(slot.plugin.manifest.id)) groups.markEnding(row.pgid);
  }

  /** Kills the worker through its handle, then waits until its groups were checked and its restart (if clean) ran. */
  async function killWorker(slot: Slot, child: PluginProcess): Promise<void> {
    if (slot.process !== child) return;
    slot.restartAfterExit = true;
    endDaemons(slot);
    child.kill();
    await slot.retired;
    await slot.queue;
  }

  /** Stops the worker and, unless the host is stopping, waits until its groups were checked. */
  async function stopProcess(slot: Slot): Promise<void> {
    const child = slot.process;
    slot.process = undefined;
    slot.info = undefined;
    endDaemons(slot);
    await child?.stop();
    if (stopping === undefined) await slot.retired;
  }

  async function stopFailed(slot: Slot, message: string): Promise<void> {
    await stopProcess(slot);
    setStatus(slot, { kind: 'crashed', reason: { kind: 'init-error', message } });
  }

  const checkHealth = healthCheck({ statusOf, setStatus, isServing: (slot) => isServing(slot.status) });

  groups.onReleased((row) => {
    const slot = slots.get(row.pluginId);
    if (slot !== undefined && row.kind === 'daemon') slot.daemonLost = true;
    if (slot?.quarantine === undefined || groups.blockedRows(row.pluginId).length > 0) return;
    const before = statusOf(slot);
    slot.quarantine = undefined;
    announce(slot, before);
    if (slot.process === undefined && stopping === undefined && !paused(slot)) void restart(slot);
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

  const boot = (list: readonly Slot[]) =>
    Promise.allSettled(
      list.filter((slot) => !paused(slot)).map((slot) =>
        enqueue(slot, async () => {
          await start(slot, await store.read(slot.plugin.manifest.id));
        }),
      ),
    );
  const failed = (await boot([...slots.values()])).find((each) => each.status === 'rejected');
  if (failed !== undefined) {
    await stopAll();
    throw failed.reason;
  }

  const requests = providerRequests({ slotOf, statusOf, isServing: serving, groups, timeouts, retire: (slot, row) => daemons.retire(slot, row), killWorker });

  const controls = pluginControls({ store, slotOf, enqueue, paused, start, stopProcess, setStatus });

  return {
    ...requests,
    ...controls,
    safeMode,
    groups,
    problems: () => problems,
    list: () => [...slots.values()].map((slot) => ({ manifest: slot.plugin.manifest, source: slot.plugin.source, status: statusOf(slot) })),
    rescan: async () => {
      if (stopping !== undefined) throw new Error('The plugin host has stopped');
      const next = await catalog();
      problems = next.problems;
      await boot(addSlots(next.plugins));
    },
    checkHealth: (pluginId) => checkHealth(slotOf(pluginId)),
    releaseGroup: (regId) => groups.releaseAnyway(regId),
    recheck: (pluginId) => daemons.recheck(slotOf(pluginId)),
    stop: stopAll,
  };
}

function isServing(status: PluginStatus): boolean {
  return status.kind === 'running' || status.kind === 'unhealthy';
}
