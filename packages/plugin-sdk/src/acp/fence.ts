/**
 * One-shot breach fence shared across turns on an ACP daemon.
 * Each turn subscribes for its own lifetime and drops the subscription in `finally`,
 * so finished turns keep no listeners or closures on the provider.
 */
export interface Fence {
  /** Why turns are no longer offered in this run, or null. */
  reason(): string | null;
  /** Trips the fence once with `reason`; later calls are ignored. */
  trip(reason: string): void;
  /**
   * Calls `listener` once if the fence trips (immediately if already tripped).
   * Call the returned function when done so nothing outlives the turn.
   */
  subscribe(listener: (reason: string) => void): () => void;
}

/** Creates a one-shot breach fence whose subscriptions are dropped individually. */
export function createFence(): Fence {
  let tripped: string | null = null;
  const listeners = new Set<(reason: string) => void>();
  return {
    reason: () => tripped,
    trip: (reason) => {
      if (tripped !== null) return;
      tripped = reason;
      const snapshot = [...listeners];
      listeners.clear();
      for (const listener of snapshot) listener(reason);
    },
    subscribe: (listener) => {
      if (tripped !== null) {
        listener(tripped);
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
