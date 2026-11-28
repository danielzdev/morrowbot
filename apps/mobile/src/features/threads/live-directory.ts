import { AgentList, Thread, ThreadSummaryList, type CreateThreadRequest } from '@morrowbot/contracts';
import type { HostResult, HostTransport } from '../../lib/host-connection.ts';
import { createStore, type ReadableStore } from '../../lib/store.ts';
import type { CreatedThread, Directory, DirectorySource } from './directory.ts';
import { changed, listed, NO_THREADS, threadRecords, viewed, withLastMessage, type ChatOnScreen, type LiveThreads } from './live-threads.ts';

export interface LiveDirectory extends DirectorySource {
  /** Loads the host's agents, folders and threads again. A failed load keeps what was shown. */
  readonly refresh: () => Promise<void>;
  /** Stops following the host's thread changes. */
  readonly close: () => void;
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

/**
 * The agents and threads of the paired host behind `transport`. It loads on the first `refresh`, then follows the
 * host's `thread.changed` frames; a reply that comes while its chat is not in `screens` is unread until it is.
 */
export function createLiveDirectory(
  transport: HostTransport,
  screens: ReadableStore<readonly ChatOnScreen[]>,
  report: (problem: string) => void,
): LiveDirectory {
  const hostId = transport.host.deviceId;
  let threads: LiveThreads = NO_THREADS;
  const store = createStore<Directory>({
    hosts: [{ id: hostId, name: transport.host.hostName }],
    agents: [],
    folders: [],
    lastMessages: [],
    threads: [],
  });
  const setThreads = (next: LiveThreads, change: (directory: Directory) => Directory = (directory) => directory): void => {
    threads = next;
    store.update((directory) => ({ ...change(directory), threads: threadRecords(next, hostId) }));
  };

  const stopScreens = screens.subscribe(() => {
    const next = viewed(threads, screens.get());
    if (next !== threads) setThreads(next);
  });
  const stopListening = transport.listen((event) => {
    if (event.kind !== 'thread.changed') return;
    const { summary } = event;
    const next = changed(threads, summary, screens.get());
    if (summary.thread.archivedAt !== null) {
      const replacement = next.summaries
        .filter(({ thread, lastMessage }) => thread.agentId === summary.thread.agentId && lastMessage !== null)
        .map(({ lastMessage }) => lastMessage)
        .reduce((newest, candidate) => (newest === null || (candidate !== null && candidate.at > newest.at) ? candidate : newest), null);
      setThreads(next, (directory) => {
        const dropped = directory.lastMessages.filter(
          (record) => !(record.hostId === hostId && record.message.threadId === summary.thread.id),
        );
        if (dropped.length === directory.lastMessages.length) return directory;
        return { ...directory, lastMessages: replacement === null ? dropped : withLastMessage(dropped, hostId, replacement) };
      });
      return;
    }
    const { lastMessage } = summary;
    setThreads(next, (directory) =>
      lastMessage === null ? directory : { ...directory, lastMessages: withLastMessage(directory.lastMessages, hostId, lastMessage) },
    );
  });

  const refresh = async (): Promise<void> => {
    const [agents, list] = await Promise.all([
      transport.request({ method: 'GET', path: '/api/agents', reply: AgentList }),
      transport.request({ method: 'GET', path: '/api/threads', reply: ThreadSummaryList }),
    ]);
    if (agents.kind !== 'ok') report(`Could not load agents: ${problemOf(agents)}`);
    if (list.kind !== 'ok') report(`Could not load threads: ${problemOf(list)}`);
    setThreads(list.kind === 'ok' ? listed(threads, list.value.threads) : threads, (directory) =>
      agents.kind === 'ok'
        ? {
            ...directory,
            agents: agents.value.agents.map((agent) => ({ hostId, agent })),
            folders: agents.value.folders.map((folder) => ({ hostId, folder })),
            lastMessages: agents.value.lastMessages.map((message) => ({ hostId, message })),
          }
        : directory,
    );
  };

  return {
    store,
    refresh,
    createThread: async (_hostId, agentId): Promise<CreatedThread> => {
      const body: CreateThreadRequest = { title: 'New chat' };
      const reply = await transport.request({ method: 'POST', path: `/api/agents/${encodeURIComponent(agentId)}/threads`, reply: Thread, body });
      if (reply.kind !== 'ok') return { kind: 'failed', message: problemOf(reply) };
      const known = threads.summaries.some(({ thread }) => thread.id === reply.value.id);
      if (!known) setThreads(changed(threads, { thread: reply.value, activity: { kind: 'idle' }, lastMessage: null }, screens.get()));
      return { kind: 'created', thread: reply.value };
    },
    close: () => {
      stopScreens();
      stopListening();
    },
  };
}
