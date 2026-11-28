import { AgentList, Thread, ThreadList, type CreateThreadRequest } from '@morrowbot/contracts';
import type { HostResult, HostTransport } from '../../lib/host-connection.ts';
import { createStore } from '../../lib/store.ts';
import { hostKey, type CreatedThread, type Directory, type DirectorySource, type ThreadActivity, type ThreadRecord } from './directory.ts';

export interface LiveDirectory extends DirectorySource {
  /** Loads the host's agents, folders and threads again. A failed load keeps what was shown. */
  readonly refresh: () => Promise<void>;
}

function problemOf(reply: Exclude<HostResult<unknown>, { readonly kind: 'ok' }>): string {
  switch (reply.kind) {
    case 'failed':
      return reply.error.message;
    case 'unreachable':
      return `Could not reach the host. ${reply.message}`;
    case 'unauthorized':
      return 'This phone is no longer paired with the host. Pair it again in Settings.';
    case 'unsupported':
      return 'This host does not offer this yet.';
    case 'malformed':
      return 'The host sent something this app cannot read. Update MorrowBot on both devices.';
  }
}

/** The agents and threads of the paired host behind `transport`. It loads on the first `refresh`. */
export function createLiveDirectory(transport: HostTransport, report: (problem: string) => void): LiveDirectory {
  const hostId = transport.host.deviceId;
  const store = createStore<Directory>({
    hosts: [{ id: hostId, name: transport.host.hostName }],
    agents: [],
    folders: [],
    lastMessages: [],
    threads: [],
  });
  const activityOf = (directory: Directory, thread: Thread): ThreadActivity =>
    directory.threads.find((each) => hostKey(each.hostId, each.thread.id) === hostKey(hostId, thread.id))?.activity ?? { kind: 'idle' };
  const record = (directory: Directory, thread: Thread): ThreadRecord => ({ hostId, thread, activity: activityOf(directory, thread) });

  const refresh = async (): Promise<void> => {
    const [agents, threads] = await Promise.all([
      transport.request({ method: 'GET', path: '/api/agents', reply: AgentList }),
      transport.request({ method: 'GET', path: '/api/threads', reply: ThreadList }),
    ]);
    if (agents.kind !== 'ok') report(`Could not load agents: ${problemOf(agents)}`);
    if (threads.kind !== 'ok') report(`Could not load threads: ${problemOf(threads)}`);
    store.update((directory) => ({
      ...directory,
      ...(agents.kind === 'ok'
        ? {
            agents: agents.value.agents.map((agent) => ({ hostId, agent })),
            folders: agents.value.folders.map((folder) => ({ hostId, folder })),
            lastMessages: agents.value.lastMessages.map((message) => ({ hostId, message })),
          }
        : {}),
      ...(threads.kind === 'ok' ? { threads: threads.value.threads.map((thread) => record(directory, thread)) } : {}),
    }));
  };

  return {
    store,
    refresh,
    createThread: async (_hostId, agentId): Promise<CreatedThread> => {
      const body: CreateThreadRequest = { title: 'New chat' };
      const reply = await transport.request({ method: 'POST', path: `/api/agents/${encodeURIComponent(agentId)}/threads`, reply: Thread, body });
      if (reply.kind !== 'ok') return { kind: 'failed', message: problemOf(reply) };
      store.update((directory) => ({ ...directory, threads: [...directory.threads, record(directory, reply.value)] }));
      return { kind: 'created', thread: reply.value };
    },
  };
}
