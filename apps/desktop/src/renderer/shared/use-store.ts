import { useEffect, useState } from 'preact/hooks';
import type { Store } from './store.ts';

/** The store's current value; re-renders on every change. */
export function useStore<T extends object>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
}
