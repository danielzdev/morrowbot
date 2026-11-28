import type { EntityId } from '@morrowbot/contracts';
import type { HostTransport } from '../../lib/host-connection.ts';
import { createStore, type ReadableStore } from '../../lib/store.ts';
import type { Directory, DirectorySource } from './directory.ts';
import { createLiveDirectory, type LiveDirectory } from './live-directory.ts';
import type { ChatOnScreen } from './live-threads.ts';

export interface HostDirectory {
  /** What the lists read: the paired host's directory, or `fallback` while no host is paired. */
  readonly source: DirectorySource;
  /** Switches to the host behind `transport`, or back to the fallback for null. */
  readonly attach: (transport: HostTransport | null) => void;
  /** Loads the paired host's directory again, as when the link comes back online. */
  readonly refresh: () => void;
  /** A chat is on screen, so its replies are read. Returns a function to call once it leaves the screen. */
  readonly viewing: (agentId: EntityId, threadId: EntityId | null) => () => void;
}

export function createHostDirectory(fallback: DirectorySource, report: (problem: string) => void): HostDirectory {
  let live: LiveDirectory | null = null;
  const screens = createStore<readonly ChatOnScreen[]>([]);
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
      live?.close();
      live = transport === null ? null : createLiveDirectory(transport, screens, report);
      stopWatching = current().store.subscribe(notify);
      notify();
    },
    refresh: () => {
      void live?.refresh();
    },
    viewing: (agentId, threadId) => {
      const screen: ChatOnScreen = { agentId, threadId };
      screens.update((list) => [...list, screen]);
      return () => {
        screens.update((list) => list.filter((each) => each !== screen));
      };
    },
  };
}
