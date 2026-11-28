import { useSyncExternalStore } from 'react';

/** A value that can be read and watched, for state that lives outside one component. */
export interface ReadableStore<T> {
  readonly get: () => T;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface Store<T> extends ReadableStore<T> {
  readonly update: (change: (current: T) => T) => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (change) => {
      const next = change(value);
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

export function useStore<T>(store: ReadableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
