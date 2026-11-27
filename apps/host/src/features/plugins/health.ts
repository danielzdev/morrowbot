import type { PluginStatus } from '@morrowbot/contracts';
import type { Slot } from './slot.ts';

export interface HealthDeps {
  readonly statusOf: (slot: Slot) => PluginStatus;
  readonly setStatus: (slot: Slot, status: PluginStatus) => void;
  readonly isServing: (slot: Slot) => boolean;
}

/** One health check per slot at a time. A timeout or error marks the plugin unhealthy; it never waits for the process to exit. */
export function healthCheck({ statusOf, setStatus, isServing }: HealthDeps): (slot: Slot) => Promise<PluginStatus> {
  async function probe(slot: Slot): Promise<PluginStatus> {
    const child = slot.process;
    if (child === undefined || !isServing(slot)) return statusOf(slot);
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
  return (slot) => {
    slot.health ??= probe(slot).finally(() => {
      slot.health = undefined;
    });
    return slot.health;
  };
}
