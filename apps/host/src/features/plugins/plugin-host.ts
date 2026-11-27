import { isDeepStrictEqual } from 'node:util';
import type {
  FinishReason,
  PluginManifest,
  PluginStatus,
  PluginStatusEvent,
  ProviderStreamRequest,
  StreamChunk,
} from '@morrowbot/contracts';
import { discoverPlugins, type DiscoveredPlugin } from './discovery.ts';
import { PluginRequestError, spawnPluginProcess, type PluginProcess, type PluginTimeouts } from './plugin-process.ts';
import type { PluginRecord, PluginStore } from './plugin-store.ts';
import { resolvePluginConfig, type ConfigResult } from './settings.ts';

export const DEFAULT_PLUGIN_TIMEOUTS: PluginTimeouts = { initMs: 10_000, healthMs: 5_000, shutdownMs: 3_000 };
const HEALTH_INTERVAL_MS = 30_000;

export interface PluginHostOptions {
  readonly pluginsDir: string;
  readonly store: PluginStore;
  /** Starts no plugin processes. Enable and config changes are still saved for the next normal start. */
  readonly safeMode: boolean;
  /** Hears every status change, including the ones during startup. */
  readonly onStatus?: (event: PluginStatusEvent) => void;
  readonly timeouts?: PluginTimeouts;
}

export interface PluginSummary {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
}

export interface PluginHost {
  /** Plugin folders that could not be loaded, and why. */
  readonly problems: readonly string[];
  list(): PluginSummary[];
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  /** Saves new settings and restarts the plugin if they are valid; returns the problems otherwise. */
  setConfig(pluginId: string, input: unknown): Promise<ConfigResult>;
  checkHealth(pluginId: string): Promise<PluginStatus>;
  stream(
    pluginId: string,
    request: ProviderStreamRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<FinishReason>;
  /** Stops every plugin process. The host refuses further changes afterwards. */
  stop(): Promise<void>;
}

interface Slot {
  readonly plugin: DiscoveredPlugin;
  status: PluginStatus;
  process: PluginProcess | undefined;
  queue: Promise<void>;
  health: Promise<PluginStatus> | undefined;
}

/** Discovers plugins and starts each enabled one in its own process (none in safe mode). */
export async function startPluginHost(options: PluginHostOptions): Promise<PluginHost> {
  const { store, safeMode } = options;
  const timeouts = options.timeouts ?? DEFAULT_PLUGIN_TIMEOUTS;
  const discovery = await discoverPlugins(options.pluginsDir);
  const slots = new Map<string, Slot>();
  let stopping: Promise<void> | undefined;
  for (const plugin of discovery.plugins) {
    const status: PluginStatus = safeMode ? { kind: 'safe-mode' } : { kind: 'stopped' };
    slots.set(plugin.manifest.id, { plugin, status, process: undefined, queue: Promise.resolve(), health: undefined });
  }

  function slotOf(pluginId: string): Slot {
    const slot = slots.get(pluginId);
    if (slot === undefined) throw new Error(`Unknown plugin "${pluginId}"`);
    return slot;
  }

  function setStatus(slot: Slot, status: PluginStatus): void {
    if (isDeepStrictEqual(slot.status, status)) return;
    slot.status = status;
    try {
      options.onStatus?.({ pluginId: slot.plugin.manifest.id, status });
    } catch (error) {
      console.error('MorrowBot host: a plugin status listener threw', error);
    }
  }

  function enqueue(slot: Slot, task: () => Promise<void>): Promise<void> {
    const run = slot.queue.then(() => {
      if (stopping !== undefined) throw new Error('The plugin host has stopped');
      return task();
    });
    slot.queue = run.catch(() => undefined);
    return run;
  }

  async function start(slot: Slot, record: PluginRecord | undefined): Promise<void> {
    const { manifest, entryPath, dir } = slot.plugin;
    if (record?.enabled === false) {
      setStatus(slot, { kind: 'disabled' });
      return;
    }
    const resolved = resolvePluginConfig(manifest.settingsSchema, record?.config ?? {});
    if (resolved.kind === 'invalid') {
      setStatus(slot, { kind: 'invalid-config', problems: [...resolved.problems] });
      return;
    }
    setStatus(slot, { kind: 'starting' });
    let child: PluginProcess;
    try {
      child = spawnPluginProcess({ entryPath, cwd: dir, envNames: manifest.env, timeouts });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(slot, { kind: 'crashed', reason: { kind: 'spawn-error', message } });
      return;
    }
    slot.process = child;
    void child.exited.then((exit) => {
      if (slot.process !== child) return;
      slot.process = undefined;
      switch (exit.kind) {
        case 'expected':
          return;
        case 'crashed':
          setStatus(slot, { kind: 'crashed', reason: exit.reason });
          return;
      }
    });
    try {
      const kind = await child.init(resolved.config);
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
    await child?.stop();
  }

  async function stopFailed(slot: Slot, message: string): Promise<void> {
    await stopProcess(slot);
    setStatus(slot, { kind: 'crashed', reason: { kind: 'init-error', message } });
  }

  function checkHealth(slot: Slot): Promise<PluginStatus> {
    slot.health ??= probe(slot).finally(() => {
      slot.health = undefined;
    });
    return slot.health;
  }

  async function probe(slot: Slot): Promise<PluginStatus> {
    const child = slot.process;
    if (child === undefined || !isServing(slot.status)) return slot.status;
    try {
      const health = await child.health();
      if (slot.process !== child) return slot.status;
      switch (health.kind) {
        case 'ok':
          setStatus(slot, { kind: 'running' });
          break;
        case 'degraded':
          setStatus(slot, { kind: 'unhealthy', detail: health.detail });
          break;
      }
    } catch (error) {
      if (!(error instanceof PluginRequestError)) await child.exited;
      else if (slot.process === child) setStatus(slot, { kind: 'unhealthy', detail: error.message });
    }
    return slot.status;
  }

  function stopAll(): Promise<void> {
    clearInterval(healthTimer);
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

  return {
    problems: discovery.problems,
    list: () => [...slots.values()].map((slot) => ({ manifest: slot.plugin.manifest, status: slot.status })),
    setEnabled: (pluginId, enabled) => {
      const slot = slotOf(pluginId);
      return enqueue(slot, async () => {
        const record = await store.read(pluginId);
        const next: PluginRecord = { enabled, config: record?.config ?? {} };
        await store.write(pluginId, next);
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
        if (safeMode || !next.enabled) return;
        await stopProcess(slot);
        await start(slot, next);
      });
      return resolved;
    },
    checkHealth: (pluginId) => checkHealth(slotOf(pluginId)),
    stream: (pluginId, request, onChunk, signal) => {
      const slot = slotOf(pluginId);
      const child = slot.process;
      if (slot.plugin.manifest.kind !== 'provider') {
        return Promise.reject(new Error(`Plugin "${pluginId}" is not a provider`));
      }
      if (child === undefined || !isServing(slot.status)) {
        return Promise.reject(new Error(`Plugin "${pluginId}" is not running (${slot.status.kind})`));
      }
      return child.stream(request, onChunk, signal);
    },
    stop: stopAll,
  };
}

function isServing(status: PluginStatus): boolean {
  return status.kind === 'running' || status.kind === 'unhealthy';
}
