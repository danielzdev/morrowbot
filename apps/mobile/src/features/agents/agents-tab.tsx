import { PlaceholderList } from '../../lib/Placeholder.tsx';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import type { TabSlot } from '../../lib/workspace.ts';

/** Placeholder until #73 lands the Agents & Folders list. */
export const agentsTab: TabSlot = {
  Sidebar: (props) => (
    <PlaceholderList
      title="Agents"
      rows={[
        { label: 'Errand Bot', detail: 'Studio Host', route: { kind: 'chat', agentId: 'errand-bot', threadId: null } },
        { label: 'Reading Buddy', detail: 'My Mac', route: { kind: 'chat', agentId: 'reading-buddy', threadId: null } },
      ]}
      {...props}
    />
  ),
  actions: [{ id: 'new', ...ACTION_PRESETS.newChat, onPress: () => undefined }],
  onSearch: () => undefined,
};
