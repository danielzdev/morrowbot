import {
  PluginConfig,
  type FinishReason,
  type PluginManifest,
  type PluginStatus,
  type PluginStatusEvent,
  type ProviderStreamRequest,
  type StreamChunk,
} from '@morrowbot/contracts';
import { discoverPlugins, type DiscoveredPlugin } from './discovery.ts';
import { PluginRequestError, spawnPluginProcess, type PluginProcess, type PluginTimeouts } from './plugin-process.ts';
import type { PluginStore } from './plugin-store.ts';
import { resolvePluginConfig, type ConfigResult } from './settings.ts';

export const DEFAULT_PLUGIN_TIMEOUTS: PluginTimeouts = { initMs: 10_000, healthMs: 5_000, shutdownMs: 3_000 };
const DEFAULT_HEALTH_INTERVAL_MS = 30_000;

export interface PluginHostOptions {
  readonly pluginsDir: string;
  readonly store: PluginStore;
  /** Starts no plugin processes. Enable and config changes are still saved for the next normal start. */
  readonly safeMode: boolean;
  readonly timeouts?: PluginTimeouts;
  readonly healthIntervalMs?: number;
}

export interface PluginSummary {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
}

export interface PluginHost {
  /** Plugin folders that could not be loaded, and why. */
  readonly problems: readonly string[];
  list(): PluginSummary[];
  onStatus(listener: (event: PluginStatusEvent) => void): () => void;
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
  stop(): Promise<void>;
}

interface Slot {
  readonly plugin: DiscoveredPlugin;
  status: PluginStatus;
  process: PluginProcess | undefined;
  queue: Promise<void>;
}

/** Discovers plugins and starts each enabled one in its own process (none in safe mode). */
export async function startPluginHost(options: PluginHostOptions): Promise<PluginHost> {
  const { store, safeMode } = options;
  const timeouts = options.timeouts ?? DEFAULT_PLUGIN_TIMEOUTS;
  const discovery = await discoverPlugins(options.pluginsDir);
  const listeners = new Set<(event: PluginStatusEvent) => void>();
  const slots = new Map<string, Slot>();
  for (const plugin of discovery.plugins) {
    const status: PluginStatus = safeMode ? { kind: 'safe-mode' } : { kind: 'starting' };
    slots.set(plugin.manifest.id, { plugin, status, process: undefined, queue: Promise.resolve() });
  }

  function slotOf(pluginId: string): Slot {
    const slot = slots.get(pluginId);
    if (slot === undefined) throw new Error(`Unknown plugin "${pluginId}"`);
    return slot;
  }

  function setStatus(slot: Slot, status: PluginStatus): void {
    slot.status = status;
    const event: PluginStatusEvent = { pluginId: slot.plugin.manifest.id, status };
    for (const listener of listeners) listener(event);
  }

  function enqueue(slot: Slot, task: () => Promise<void>): Promise<void> {
    const run = slot.queue.then(task);
    slot.queue = run.catch(() => undefined);
    return run;
  }

  async function start(slot: Slot): Promise<void> {
    const { manifest, entryPath, dir } = slot.plugin;
    const record = await store.read(manifest.id);
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
    const child = spawnPluginProcess({ entryPath, cwd: dir, timeouts });
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

  async function checkHealth(slot: Slot): Promise<PluginStatus> {
    const child = slot.process;
    if (child === undefined || !isServing(slot.status)) return slot.status;
    try {
      const health = await child.health();
      if (slot.process !== child) return slot.status;
      switch (health.kind) {
        case 'ok':
          if (slot.status.kind !== 'running') setStatus(slot, { kind: 'running' });
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

  if (!safeMode) await Promise.all([...slots.values()].map((slot) => enqueue(slot, () => start(slot))));

  const healthTimer = setInterval(() => {
    for (const slot of slots.values()) void checkHealth(slot);
  }, options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS);
  healthTimer.unref();

  return {
    problems: discovery.problems,
    list: () => [...slots.values()].map((slot) => ({ manifest: slot.plugin.manifest, status: slot.status })),
    onStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled: (pluginId, enabled) => {
      const slot = slotOf(pluginId);
      return enqueue(slot, async () => {
        const record = await store.read(pluginId);
        await store.write(pluginId, { enabled, config: record?.config ?? {} });
        if (safeMode) return;
        if (!enabled) {
          await stopProcess(slot);
          setStatus(slot, { kind: 'disabled' });
        } else if (slot.process === undefined) {
          await start(slot);
        }
      });
    },
    setConfig: async (pluginId, input) => {
      const slot = slotOf(pluginId);
      const resolved = resolvePluginConfig(slot.plugin.manifest.settingsSchema, input);
      if (resolved.kind === 'invalid') return resolved;
      const config = PluginConfig.parse(input);
      await enqueue(slot, async () => {
        const record = await store.read(pluginId);
        const enabled = record?.enabled ?? true;
        await store.write(pluginId, { enabled, config });
        if (safeMode || !enabled) return;
        await stopProcess(slot);
        await start(slot);
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
    stop: async () => {
      clearInterval(healthTimer);
      await Promise.all([...slots.values()].map((slot) => enqueue(slot, () => stopProcess(slot))));
    },
  };
}

function isServing(status: PluginStatus): boolean {
  return status.kind === 'running' || status.kind === 'unhealthy';
}
