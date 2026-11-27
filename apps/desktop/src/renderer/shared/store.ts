/** One piece of UI state with one owner: readers subscribe, only the owner calls `set`. */
export class Store<T> {
  private value: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    for (const listener of [...this.listeners]) listener(this.value);
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Resolves with the store's value once `match` holds (checked now and on every change). */
export function until<T>(store: Store<T>, match: (value: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    if (match(store.get())) {
      resolve(store.get());
      return;
    }
    const stop = store.subscribe((value) => {
      if (!match(value)) return;
      stop();
      resolve(value);
    });
  });
}

/** Data that is fetched from the host. */
export type Loadable<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly value: T }
  | { readonly kind: 'failed'; readonly message: string };
