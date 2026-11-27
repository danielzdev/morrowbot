import { PlaceholderBody, PlaceholderList, PlaceholderTitle } from '../../lib/Placeholder.tsx';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import type { DetailSlot, SettingsSection, TabSlot } from '../../lib/workspace.ts';

const SECTIONS: readonly { readonly section: SettingsSection; readonly label: string }[] = [
  { section: 'connections', label: 'Connections' },
  { section: 'notifications', label: 'Notifications' },
  { section: 'appearance', label: 'Appearance' },
  { section: 'providers', label: 'Providers & Models' },
  { section: 'usage', label: 'Usage' },
];

/** Placeholder until #72 lands Settings and host Connections. */
export const settingsTab: TabSlot = {
  Sidebar: (props) => (
    <PlaceholderList
      title="Settings"
      rows={SECTIONS.map(({ section, label }) => ({ label, detail: '', route: { kind: 'settings', section } }))}
      {...props}
    />
  ),
  actions: [],
  onSearch: () => undefined,
};

export const settingsDetail: DetailSlot<'settings'> = {
  tabs: ['settings'],
  Title: ({ route }) => (
    <PlaceholderTitle title={SECTIONS.find((item) => item.section === route.section)?.label ?? ''} subtitle="Settings" />
  ),
  Body: () => <PlaceholderBody text="Settings arrive with #72." />,
  actions: (route) =>
    route.section === 'connections' ? [{ id: 'add-host', ...ACTION_PRESETS.addHost, onPress: () => undefined }] : [],
};
