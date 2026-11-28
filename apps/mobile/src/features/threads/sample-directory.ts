import type { Agent, EntityId, Thread } from '@morrowbot/contracts';
import { sampleCatalog } from '../../lib/sample-catalog.ts';
import { createStore } from '../../lib/store.ts';
import type { CreatedThread, Directory, DirectorySource } from './directory.ts';

/** Made-up agents and threads on one host, shown while no host is paired. Ages are relative to `now` so the lists look current. */
export function sampleDirectory(now: number): Directory {
  const catalog = sampleCatalog(now);
  const { hostId, hostName } = catalog;
  return {
    hosts: [{ id: hostId, name: hostName }],
    agents: catalog.agents.map((agent) => ({ hostId, agent })),
    folders: catalog.folders.map((folder) => ({ hostId, folder })),
    lastMessages: catalog.lastMessages.map((message) => ({ hostId, message })),
    threads: catalog.threads.map(({ thread, activity }) => ({ hostId, thread, activity })),
  };
}

export interface SampleDirectoryHooks {
  readonly createThread?: (agentId: EntityId) => Promise<CreatedThread>;
  readonly onAgentChanged?: (listener: (agent: Agent) => void) => () => void;
  readonly onAgentDeleted?: (listener: (agentId: EntityId) => void) => () => void;
  readonly onThreadCreated?: (listener: (thread: Thread) => void) => () => void;
}

/** An in-memory directory over the sample data; new threads live only until the app closes. */
export function createSampleDirectory(clock: () => number = Date.now, hooks: SampleDirectoryHooks = {}): DirectorySource {
  const initial = sampleDirectory(clock());
  const defaultHostId = initial.hosts[0]?.id ?? 'studio-host';
  const store = createStore(initial);
  let created = 0;

  const appendThread = (hostId: EntityId, fresh: Thread): void => {
    store.update((directory) =>
      directory.threads.some(({ thread }) => thread.id === fresh.id)
        ? directory
        : { ...directory, threads: [...directory.threads, { hostId, thread: fresh, activity: { kind: 'idle' } }] },
    );
  };

  hooks.onAgentChanged?.((updated) => {
    store.update((directory) => ({
      ...directory,
      agents: directory.agents.map((entry) =>
        entry.agent.id === updated.id && updated.revision >= entry.agent.revision ? { ...entry, agent: updated } : entry,
      ),
    }));
  });
  hooks.onAgentDeleted?.((agentId) => {
    store.update((directory) => ({
      ...directory,
      agents: directory.agents.filter((entry) => entry.agent.id !== agentId),
      threads: directory.threads.filter((entry) => entry.thread.agentId !== agentId),
      lastMessages: directory.lastMessages.filter((entry) => entry.message.agentId !== agentId),
    }));
  });
  hooks.onThreadCreated?.((fresh) => {
    appendThread(defaultHostId, fresh);
  });

  return {
    store,
    createThread: async (hostId: EntityId, agentId: EntityId): Promise<CreatedThread> => {
      let fresh: Thread;
      if (hooks.createThread !== undefined) {
        const result = await hooks.createThread(agentId);
        if (result.kind !== 'created') return result;
        fresh = result.thread;
      } else {
        if (!store.get().agents.some((entry) => entry.agent.id === agentId)) {
          return { kind: 'failed', message: 'Agent not found' };
        }
        created += 1;
        const time = new Date(clock()).toISOString();
        fresh = { id: `new-${String(created)}`, agentId, title: 'New chat', createdAt: time, updatedAt: time };
      }
      appendThread(hostId, fresh);
      return { kind: 'created', thread: fresh };
    },
  };
}
