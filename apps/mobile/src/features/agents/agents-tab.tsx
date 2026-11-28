import { createListSearch, openListSearch } from '../../lib/ListChrome.tsx';
import { createStore, type ReadableStore } from '../../lib/store.ts';
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
  const collapsed = createStore<ReadonlySet<string>>(new Set());
  return {
    Sidebar: (props) => <AgentsSidebar {...props} directory={options.directory} search={search} collapsed={collapsed} />,
    actions: options.actions,
    onSearch: () => {
      openListSearch(search);
    },
  };
}
