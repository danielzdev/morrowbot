import type { PluginStatus } from '@morrowbot/contracts';
import type { PluginRecord, PluginStore } from './plugin-store.ts';
import { resolvePluginConfig, type ConfigResult } from './settings.ts';
import type { Slot } from './slot.ts';

/** Why a Restart did not run; `restarted` once a new worker was started. */
export type RestartResult = 'restarted' | 'safe-mode' | 'disabled' | 'quarantined' | 'busy';

export interface ControlDeps {
  readonly store: PluginStore;
  readonly slotOf: (pluginId: string) => Slot;
  readonly enqueue: (slot: Slot, task: () => Promise<void>) => Promise<void>;
  /** True while safe mode keeps this plugin from starting. */
  readonly paused: (slot: Slot) => boolean;
  readonly start: (slot: Slot, record: PluginRecord | undefined) => Promise<void>;
  readonly stopProcess: (slot: Slot) => Promise<void>;
  readonly setStatus: (slot: Slot, status: PluginStatus) => void;
}

/** The user's switches on one plugin: on/off, its settings, and Restart. Each runs in the plugin's queue. */
export function pluginControls({ store, slotOf, enqueue, paused, start, stopProcess, setStatus }: ControlDeps) {
  return {
    setEnabled: (pluginId: string, enabled: boolean): Promise<void> => {
      const slot = slotOf(pluginId);
      return enqueue(slot, async () => {
        const record = await store.read(pluginId);
        const next: PluginRecord = { enabled, config: record?.config ?? {} };
        await store.write(pluginId, next);
        slot.configRevision += 1;
        if (paused(slot)) return;
        if (!enabled) {
          await stopProcess(slot);
          setStatus(slot, { kind: 'disabled' });
        } else if (slot.process === undefined) {
          await start(slot, next);
        }
      });
    },
    /** Saves new settings and restarts the plugin if they are valid; returns the problems otherwise. */
    setConfig: async (pluginId: string, input: unknown): Promise<ConfigResult> => {
      const slot = slotOf(pluginId);
      const resolved = resolvePluginConfig(slot.plugin.manifest.settingsSchema, input);
      if (resolved.kind === 'invalid') return resolved;
      await enqueue(slot, async () => {
        const record = await store.read(pluginId);
        const next: PluginRecord = { enabled: record?.enabled ?? true, config: resolved.saved };
        await store.write(pluginId, next);
        slot.configRevision += 1;
        if (paused(slot) || !next.enabled) return;
        await stopProcess(slot);
        await start(slot, next);
      });
      return resolved;
    },
    /** Stops the plugin's worker and starts a fresh one. Refused while it has turns, is quarantined, off, or paused by safe mode. */
    restart: async (pluginId: string): Promise<RestartResult> => {
      const slot = slotOf(pluginId);
      if (paused(slot)) return 'safe-mode';
      if (slot.quarantine !== undefined) return 'quarantined';
      if (slot.turns.size > 0) return 'busy';
      let result: RestartResult = 'restarted';
      await enqueue(slot, async () => {
        const record = await store.read(pluginId);
        if (record?.enabled === false) {
          result = 'disabled';
          return;
        }
        await stopProcess(slot);
        await start(slot, record);
      });
      return result;
    },
  };
}
