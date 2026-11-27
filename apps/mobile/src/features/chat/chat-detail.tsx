import { PlaceholderBody, PlaceholderTitle } from '../../lib/Placeholder.tsx';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import type { DetailSlot } from '../../lib/workspace.ts';

/** Placeholder until #74 lands the chat canvas, composer and Agent Settings sheet. */
export const chatDetail: DetailSlot<'chat'> = {
  tabs: ['agents', 'threads'],
  Title: ({ route }) => <PlaceholderTitle title={route.agentId} subtitle={route.threadId ?? 'Main thread'} />,
  Body: () => <PlaceholderBody text="Chat arrives with #74." />,
  actions: () => [
    { id: 'new-thread', ...ACTION_PRESETS.newThread, onPress: () => undefined },
    { id: 'agent-settings', ...ACTION_PRESETS.agentSettings, onPress: () => undefined },
  ],
};
