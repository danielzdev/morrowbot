import { PlaceholderBody, PlaceholderList, PlaceholderTitle } from '../../lib/Placeholder.tsx';
import type { DetailSlot, TabSlot } from '../../lib/workspace.ts';

/** Placeholder until #74 lands Plugins | Connectors | Marketplace. */
export const extensionsTab: TabSlot = {
  Sidebar: (props) => (
    <PlaceholderList
      title="Extensions"
      rows={[
        { label: 'Plugins', detail: 'Installed plugins', route: { kind: 'extension', extensionId: 'plugins' } },
        { label: 'Connectors', detail: 'Connected services', route: { kind: 'extension', extensionId: 'connectors' } },
        { label: 'Marketplace', detail: 'Find more', route: { kind: 'extension', extensionId: 'marketplace' } },
      ]}
      {...props}
    />
  ),
  actions: [],
  onSearch: null,
};

export const extensionDetail: DetailSlot<'extension'> = {
  tabs: ['extensions'],
  Title: ({ route }) => <PlaceholderTitle title={route.extensionId} subtitle="Extensions" />,
  Body: () => <PlaceholderBody text="Extensions arrive with #74." />,
  actions: () => [],
};
