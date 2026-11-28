import { useSyncExternalStore } from 'react';

/** One piece of state with one owner; screens read it with `useStore`. */
export class Store<T> {
  #value: T;
  readonly #listeners = new Set<(value: T) => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get(): T {
    return this.#value;
  }

  set(value: T): void {
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const listener of [...this.#listeners]) listener(value);
  }

  update(change: (value: T) => T): void {
    this.set(change(this.#value));
  }

  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

export type Loadable<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly value: T };

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.get(),
  );
}
