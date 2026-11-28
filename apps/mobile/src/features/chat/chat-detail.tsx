import { ACTION_PRESETS } from '../../lib/symbols.ts';
import type { DetailSlot } from '../../lib/workspace.ts';
import { ChatBody } from './ChatBody.tsx';
import { chatRequests } from './chat-context.tsx';
import { ChatTitle } from './ChatTitle.tsx';

export const chatDetail: DetailSlot<'chat'> = {
  tabs: ['agents', 'threads'],
  Title: ChatTitle,
  Body: ChatBody,
  actions: (route) => [
    {
      id: 'new-thread',
      ...ACTION_PRESETS.newThread,
      onPress: (navigation) => {
        chatRequests.post({ kind: 'new-thread', agentId: route.agentId, navigation });
      },
    },
    {
      id: 'agent-settings',
      ...ACTION_PRESETS.agentSettings,
      onPress: () => {
        chatRequests.post({ kind: 'agent-settings', agentId: route.agentId });
      },
    },
  ],
};
