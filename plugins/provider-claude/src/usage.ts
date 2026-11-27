import type { UsageWindow } from '@morrowbot/plugin-sdk';

/** The plan usage this process has seen in `rate_limit_event`s, for one account at a time. */
export interface UsageSnapshot {
  /** Merges windows by id; a window older than the one already kept is ignored. Another account's windows replace the snapshot. */
  observe(accountKey: string, observedAt: string, windows: readonly UsageWindow[]): void;
  /** The account's windows with the oldest of their observation times, so none looks fresher than it is; null when none were seen. */
  read(accountKey: string): { readonly observedAt: string; readonly windows: readonly UsageWindow[] } | null;
  clear(): void;
}

interface Seen {
  readonly observedAt: string;
  readonly window: UsageWindow;
}

export function createUsageSnapshot(): UsageSnapshot {
  let owner: string | null = null;
  let windows = new Map<string, Seen>();
  return {
    observe: (accountKey, observedAt, observed) => {
      if (accountKey === '') return;
      if (owner !== accountKey) {
        owner = accountKey;
        windows = new Map();
      }
      for (const window of observed) {
        const kept = windows.get(window.id);
        if (kept === undefined || Date.parse(kept.observedAt) <= Date.parse(observedAt)) windows.set(window.id, { observedAt, window });
      }
    },
    read: (accountKey) => {
      if (owner !== accountKey || windows.size === 0) return null;
      const seen = [...windows.values()];
      const observedAt = seen.map((entry) => entry.observedAt).reduce((oldest, at) => (Date.parse(at) < Date.parse(oldest) ? at : oldest));
      return { observedAt, windows: seen.map((entry) => entry.window) };
    },
    clear: () => {
      owner = null;
      windows = new Map();
    },
  };
}
