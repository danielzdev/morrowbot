import { createListSearch, openListSearch } from '../../lib/ListChrome.tsx';
import type { ReadableStore } from '../../lib/store.ts';
import type { SlotAction, TabSlot } from '../../lib/workspace.ts';
import type { AgentsDirectory } from './agent-groups.ts';
import { AgentsSidebar } from './AgentsSidebar.tsx';

/**
 * The Agents tab over a host directory. Tapping an agent opens its main thread; `actions` are the
 * list's floating buttons (the app passes New Thread from `features/threads`).
 */
export function createAgentsTab(options: {
  readonly directory: ReadableStore<AgentsDirectory>;
  readonly actions: readonly SlotAction[];
}): TabSlot {
  const search = createListSearch();
  return {
    Sidebar: (props) => <AgentsSidebar {...props} directory={options.directory} search={search} />,
    actions: options.actions,
    onSearch: () => {
      openListSearch(search);
    },
  };
}
