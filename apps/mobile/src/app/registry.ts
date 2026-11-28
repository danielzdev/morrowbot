import { createAgentsTab } from '../features/agents/index.ts';
import { chatDetail } from '../features/chat/index.ts';
import { connection } from '../features/connection/index.ts';
import { extensionDetail, extensionsTab } from '../features/extensions/index.ts';
import { settingsDetail, settingsTab } from '../features/settings/index.ts';
import { createSampleDirectory, createThreadsSlice } from '../features/threads/index.ts';
import type { WorkspaceRegistry } from '../lib/workspace.ts';

/** Sample agents and threads until the live host client (#72) supplies the directory. */
const directory = createSampleDirectory();
const threads = createThreadsSlice(directory);

/** Wires each feature slice's slots into the shell. Slices change their own exports, not this. */
export const registry: WorkspaceRegistry = {
  connection,
  tabs: {
    agents: createAgentsTab({ directory: directory.store, actions: [threads.pickAgentForNewThread] }),
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
