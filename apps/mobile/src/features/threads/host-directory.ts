import type { HostTransport } from '../../lib/host-connection.ts';
import type { ReadableStore } from '../../lib/store.ts';
import type { Directory, DirectorySource } from './directory.ts';
import { createLiveDirectory, type LiveDirectory } from './live-directory.ts';

export interface HostDirectory {
  /** What the lists read: the paired host's directory, or `fallback` while no host is paired. */
  readonly source: DirectorySource;
  /** Switches to the host behind `transport`, or back to the fallback for null. */
  readonly attach: (transport: HostTransport | null) => void;
  /** Loads the paired host's directory again, as when the link comes back online. */
  readonly refresh: () => void;
}

export function createHostDirectory(fallback: DirectorySource, report: (problem: string) => void): HostDirectory {
  let live: LiveDirectory | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const current = (): DirectorySource => live ?? fallback;
  let stopWatching = fallback.store.subscribe(notify);

  const store: ReadableStore<Directory> = {
    get: () => current().store.get(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    source: { store, createThread: (hostId, agentId) => current().createThread(hostId, agentId) },
    attach: (transport) => {
      stopWatching();
      live = transport === null ? null : createLiveDirectory(transport, report);
      stopWatching = current().store.subscribe(notify);
      notify();
    },
    refresh: () => {
      void live?.refresh();
    },
  };
}
