import { PlaceholderList } from '../../lib/Placeholder.tsx';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import type { TabSlot } from '../../lib/workspace.ts';

/** Placeholder until #73 lands the All Threads list (Needs you, Working, Recent). */
export const threadsTab: TabSlot = {
  Sidebar: (props) => (
    <PlaceholderList
      title="All Threads"
      rows={[
        {
          label: 'Plan the weekend errands',
          detail: 'Errand Bot · Working',
          route: { kind: 'chat', agentId: 'errand-bot', threadId: 'weekend-errands' },
        },
      ]}
      {...props}
    />
  ),
  actions: [{ id: 'new', ...ACTION_PRESETS.newChat, onPress: () => undefined }],
  onSearch: () => undefined,
};
