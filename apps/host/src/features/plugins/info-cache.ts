import type { ProviderInfo } from '@morrowbot/contracts';
import type { PluginProcess } from './plugin-process.ts';
import type { InfoEntry, Slot } from './slot.ts';

/**
 * Asks the worker for provider-info and makes it the slot's entry. The answer is published only if
 * the daemon revision has not moved meanwhile; a failure puts back `previous` (the last good answer).
 */
export function ask(slot: Slot, child: PluginProcess, worker: number, refresh: boolean, previous: ProviderInfo | undefined): InfoEntry {
  const revision = slot.daemonRevision;
  const entry: InfoEntry = { worker, revision, askedAt: performance.now(), refresh, value: child.providerInfo(refresh), settled: previous, done: false };
  slot.info = entry;
  entry.value.then(
    (value) => {
      entry.done = true;
      if (slot.daemonRevision !== revision) {
        if (slot.info === entry) slot.info = undefined;
        return;
      }
      entry.settled = value;
      if (refresh) slot.daemonLost = false;
    },
    () => {
      entry.done = true;
      if (slot.info !== entry) return;
      slot.info = previous === undefined || slot.daemonRevision !== revision ? undefined : settledEntry(worker, revision, previous, entry.askedAt);
    },
  );
  return entry;
}

/** An entry that already holds an answer. */
export function settledEntry(worker: number, revision: number, info: ProviderInfo, askedAt = performance.now()): InfoEntry {
  return { worker, revision, askedAt, refresh: false, value: Promise.resolve(info), settled: info, done: true };
}
