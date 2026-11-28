import { Text, View } from 'react-native';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import { typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { DetailSlot, SettingsSection, TabSlot } from '../../lib/workspace.ts';
import { AppearanceScreen } from './AppearanceScreen.tsx';
import { ConnectionsScreen } from './ConnectionsScreen.tsx';
import { NotificationsScreen } from './NotificationsScreen.tsx';
import { ProvidersScreen } from './ProvidersScreen.tsx';
import { sectionInfo } from './sections.ts';
import { settingsUi } from './settings-store.ts';
import { SettingsSidebar } from './SettingsSidebar.tsx';
import { UsageScreen } from './UsageScreen.tsx';

export const settingsTab: TabSlot = {
  Sidebar: SettingsSidebar,
  actions: [],
  onSearch: settingsUi.openSearch,
};

function SectionBody(props: { readonly section: SettingsSection }) {
  switch (props.section) {
    case 'connections':
      return <ConnectionsScreen />;
    case 'notifications':
      return <NotificationsScreen />;
    case 'appearance':
      return <AppearanceScreen />;
    case 'providers':
      return <ProvidersScreen />;
    case 'usage':
      return <UsageScreen />;
  }
}

function SectionTitle(props: { readonly section: SettingsSection }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[typography.title, { color: colors.text1 }]} numberOfLines={1}>
        {sectionInfo(props.section).label}
      </Text>
      <Text style={[typography.small, { color: colors.text3 }]}>Settings</Text>
    </View>
  );
}

export const settingsDetail: DetailSlot<'settings'> = {
  tabs: ['settings'],
  Title: ({ route }) => <SectionTitle section={route.section} />,
  Body: ({ route }) => <SectionBody section={route.section} />,
  actions: (route) =>
    route.section === 'connections' ? [{ id: 'add-host', ...ACTION_PRESETS.addHost, onPress: settingsUi.openPairing }] : [],
};
