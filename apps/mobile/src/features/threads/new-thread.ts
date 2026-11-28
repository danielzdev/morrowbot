import type { EntityId } from '@morrowbot/contracts';
import { ActionSheetIOS } from 'react-native';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import type { SlotAction, WorkspaceNavigation } from '../../lib/workspace.ts';
import type { DirectorySource } from './directory.ts';
import { agentsIn, hostOfAgent } from './thread-groups.ts';

function start(source: DirectorySource, navigation: WorkspaceNavigation, hostId: EntityId, agentId: EntityId): void {
  const thread = source.createThread(hostId, agentId);
  navigation.open({ kind: 'chat', agentId, threadId: thread.id });
}

/** Asks which agent to start with, in a native action sheet, then opens the new thread. */
function pickAgent(source: DirectorySource, navigation: WorkspaceNavigation): void {
  const choices = agentsIn(source.store.get(), { kind: 'all' });
  if (choices.length === 0) return;
  ActionSheetIOS.showActionSheetWithOptions(
    { title: 'New thread with…', options: [...choices.map(({ label }) => label), 'Cancel'], cancelButtonIndex: choices.length },
    (index) => {
      const choice = choices[index];
      if (choice) start(source, navigation, choice.value.hostId, choice.value.agentId);
    },
  );
}

/** New Thread on a list: pick the agent first. */
export function pickAgentAction(source: DirectorySource): SlotAction {
  return {
    id: 'new-thread',
    ...ACTION_PRESETS.newThread,
    onPress: (navigation) => {
      pickAgent(source, navigation);
    },
  };
}

/** New Thread inside an agent's chat: start straight away in that agent. */
export function newThreadInAgent(source: DirectorySource, agentId: EntityId): SlotAction {
  return {
    id: 'new-thread',
    ...ACTION_PRESETS.newThread,
    onPress: (navigation) => {
      const hostId = hostOfAgent(source.store.get(), agentId);
      if (hostId === null) pickAgent(source, navigation);
      else start(source, navigation, hostId, agentId);
    },
  };
}
