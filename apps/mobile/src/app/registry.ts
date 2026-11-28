import { createAgentsTab } from '../features/agents/index.ts';
import { chatDetail, createSampleChatHost } from '../features/chat/index.ts';
import { connection } from '../features/connection/index.ts';
import { extensionDetail, extensionsTab } from '../features/extensions/index.ts';
import { settingsDetail, settingsTab } from '../features/settings/index.ts';
import { createHostDirectory, createSampleDirectory, createThreadsSlice, trackChatOnScreen } from '../features/threads/index.ts';
import type { WorkspaceRegistry } from '../lib/workspace.ts';

/** While no host is paired, chat, Extensions and the lists share this one in-memory sample host. */
export const sampleHost = createSampleChatHost();

/** The paired host's agents and threads; `HostProviders` attaches the host. */
export const directory = createHostDirectory(
  createSampleDirectory(Date.now, {
    createThread: async (agentId) => {
      const created = await sampleHost.createThread(agentId);
      return created.kind === 'ok'
        ? { kind: 'created', thread: created.value }
        : { kind: 'failed', message: created.error.message };
    },
    onAgentChanged: (listener) => sampleHost.onAgentChanged(listener),
    onAgentDeleted: (listener) => sampleHost.onAgentDeleted(listener),
    onThreadCreated: (listener) => sampleHost.onThreadCreated(listener),
  }),
  (problem) => {
    console.warn(`Ori Kami directory: ${problem}`);
  },
);
const threads = createThreadsSlice(directory.source);

/** Wires each feature slice's slots into the shell. Slices change their own exports, not this. */
export const registry: WorkspaceRegistry = {
  connection,
  tabs: {
    agents: createAgentsTab({ directory: directory.source.store, actions: [threads.pickAgentForNewThread] }),
    threads: threads.tab,
    extensions: extensionsTab,
    settings: settingsTab,
  },
  details: {
    chat: {
      ...chatDetail,
      Body: trackChatOnScreen(directory, chatDetail.Body),
      actions: (route) => [
        threads.newThreadIn(route.agentId),
        ...chatDetail.actions(route).filter(({ id }) => id !== 'new-thread'),
      ],
    },
    settings: settingsDetail,
    extension: extensionDetail,
  },
};
