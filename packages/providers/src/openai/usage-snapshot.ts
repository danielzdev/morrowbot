import type { UsageWindow } from '@morrowbot/plugin-sdk';

/** The plan usage this process has read, for one account at a time. */
export interface UsageSnapshot {
  /** Replaces the windows with a newer read; another account's read replaces the snapshot. */
  observe(accountKey: string, observedAt: string, windows: readonly UsageWindow[]): void;
  read(accountKey: string): { readonly observedAt: string; readonly windows: readonly UsageWindow[] } | null;
  clear(): void;
}

export function createUsageSnapshot(): UsageSnapshot {
  let kept: { readonly accountKey: string; readonly observedAt: string; readonly windows: readonly UsageWindow[] } | null = null;
  return {
    observe: (accountKey, observedAt, windows) => {
      if (accountKey === '') return;
      if (kept !== null && kept.accountKey === accountKey && Date.parse(kept.observedAt) >= Date.parse(observedAt)) return;
      kept = { accountKey, observedAt, windows: [...windows] };
    },
    read: (accountKey) => (kept?.accountKey === accountKey ? kept : null),
    clear: () => {
      kept = null;
    },
  };
}
