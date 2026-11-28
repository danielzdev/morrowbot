import { useSyncExternalStore } from 'react';

/**
 * Settings UI state that the shell's buttons change from outside the screens: the Search pill
 * opens the sidebar's search field, and the `+` action opens the pairing sheet.
 */
export type SettingsUi = {
  readonly search: { readonly kind: 'closed' } | { readonly kind: 'open'; readonly query: string };
  readonly pairing: 'closed' | 'open';
};

let current: SettingsUi = { search: { kind: 'closed' }, pairing: 'closed' };
const listeners = new Set<() => void>();

function set(next: SettingsUi): void {
  current = next;
  for (const listener of listeners) listener();
}

export const settingsUi = {
  openSearch: () => {
    if (current.search.kind === 'closed') set({ ...current, search: { kind: 'open', query: '' } });
  },
  setQuery: (query: string) => {
    set({ ...current, search: { kind: 'open', query } });
  },
  closeSearch: () => {
    set({ ...current, search: { kind: 'closed' } });
  },
  openPairing: () => {
    set({ ...current, pairing: 'open' });
  },
  closePairing: () => {
    set({ ...current, pairing: 'closed' });
  },
};

export function useSettingsUi(): SettingsUi {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
