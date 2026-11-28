import { createAgentsTab } from '../features/agents/index.ts';
import { chatDetail } from '../features/chat/index.ts';
import { connection } from '../features/connection/index.ts';
import { extensionDetail, extensionsTab } from '../features/extensions/index.ts';
import { settingsDetail, settingsTab } from '../features/settings/index.ts';
import { createHostDirectory, createSampleDirectory, createThreadsSlice } from '../features/threads/index.ts';
import type { WorkspaceRegistry } from '../lib/workspace.ts';

/** The paired host's agents and threads; `HostProviders` attaches the host. */
export const directory = createHostDirectory(createSampleDirectory(), (problem) => {
  console.warn(`MorrowBot directory: ${problem}`);
});
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
      actions: (route) => [
        threads.newThreadIn(route.agentId),
        ...chatDetail.actions(route).filter(({ id }) => id !== 'new-thread'),
      ],
    },
    settings: settingsDetail,
    extension: extensionDetail,
  },
};
