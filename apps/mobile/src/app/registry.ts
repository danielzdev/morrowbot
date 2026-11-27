import { agentsTab } from '../features/agents/index.ts';
import { chatDetail } from '../features/chat/index.ts';
import { connection } from '../features/connection/index.ts';
import { extensionDetail, extensionsTab } from '../features/extensions/index.ts';
import { settingsDetail, settingsTab } from '../features/settings/index.ts';
import { threadsTab } from '../features/threads/index.ts';
import type { WorkspaceRegistry } from '../lib/workspace.ts';

/** Wires each feature slice's slots into the shell. Slices change their own exports, not this. */
export const registry: WorkspaceRegistry = {
  connection,
  tabs: { agents: agentsTab, threads: threadsTab, extensions: extensionsTab, settings: settingsTab },
  details: { chat: chatDetail, settings: settingsDetail, extension: extensionDetail },
};
