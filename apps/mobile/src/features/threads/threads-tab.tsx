import type { EntityId } from '@morrowbot/contracts';
import { createListSearch, openListSearch } from '../../lib/ListChrome.tsx';
import type { SlotAction, TabSlot } from '../../lib/workspace.ts';
import type { DirectorySource } from './directory.ts';
import { newThreadInAgent, pickAgentAction } from './new-thread.ts';
import { ThreadsSidebar } from './ThreadsSidebar.tsx';

export interface ThreadsSlice {
  /** The All Threads tab, whose New Thread asks for an agent first. */
  readonly tab: TabSlot;
  /** New Thread for another list (Agents): asks for an agent first. */
  readonly pickAgentForNewThread: SlotAction;
  /** New Thread inside an agent's chat: starts in that agent. */
  readonly newThreadIn: (agentId: EntityId) => SlotAction;
}

export function createThreadsSlice(source: DirectorySource): ThreadsSlice {
  const search = createListSearch();
  const pick = pickAgentAction(source);
  return {
    tab: {
      Sidebar: (props) => <ThreadsSidebar {...props} directory={source.store} search={search} />,
      actions: [pick],
      onSearch: () => {
        openListSearch(search);
      },
    },
    pickAgentForNewThread: pick,
    newThreadIn: (agentId) => newThreadInAgent(source, agentId),
  };
}
