import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHostConnection } from '../../lib/host-connection.ts';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { SidebarProps } from '../../lib/workspace.ts';
import { Chevron, Group, IconTile, Note, Row, StatusDot } from './grouped.tsx';
import { describeLink } from './link-status.ts';
import { PairHostSheet } from './PairHostSheet.tsx';
import { searchSections } from './sections.ts';
import { settingsUi, useSettingsUi } from './settings-store.ts';
import { useClock } from './use-clock.ts';

/** The Settings list: the active host up top, then each section; filtered while searching. */
export function SettingsSidebar(props: SidebarProps) {
  const { colors, scheme } = useTheme();
  const ui = useSettingsUi();
  const connection = useHostConnection();
  const now = useClock();
  const active = connection.state.kind === 'ready' ? connection.state.active : null;
  const query = ui.search.kind === 'open' ? ui.search.query : '';
  const sections = searchSections(query);
  const selectedSection = props.selected?.kind === 'settings' ? props.selected.section : null;
  const openConnections = (): void => {
    props.navigation.open({ kind: 'settings', section: 'connections' });
  };
  const status = active === null ? null : describeLink(active.status, now);

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      <Text style={[typography.largeTitle, styles.title, { color: colors.text1 }]}>Settings</Text>
      {ui.search.kind === 'open' ? (
        <View style={styles.searchRow}>
          <View style={[styles.search, { backgroundColor: colors.surface3 }]}>
            <SymbolView name="magnifyingglass" size={16} tintColor={colors.text3} />
            <TextInput
              autoFocus
              accessibilityLabel="Search settings"
              value={query}
              onChangeText={settingsUi.setQuery}
              placeholder="Search settings"
              placeholderTextColor={colors.text3}
              autoCorrect={false}
              keyboardAppearance={scheme}
              returnKeyType="search"
              style={[typography.ui, styles.searchInput, { color: colors.text1 }]}
            />
          </View>
          <Pressable accessibilityRole="button" onPress={settingsUi.closeSearch} hitSlop={8}>
            <Text style={[typography.ui, { color: colors.accent }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active === null ? 'Pair a host' : `${active.host.hostName}, ${status?.label ?? ''}`}
          onPress={active === null ? settingsUi.openPairing : openConnections}
          style={[styles.hostCard, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}
        >
          <View style={[styles.hostIcon, { backgroundColor: colors.accent }]}>
            <SymbolView name="desktopcomputer" size={24} tintColor={colors.onAccent} />
          </View>
          <View style={styles.hostText}>
            <Text style={[typography.title, { color: colors.text1 }]} numberOfLines={1}>
              {active === null ? 'Pair a Host' : active.host.hostName}
            </Text>
            <View style={[styles.hostStatus, status !== null && styles.hostStatusWithDot]}>
              {status === null ? null : <StatusDot tone={status.tone} />}
              <Text style={[typography.small, { color: colors.text3 }]} numberOfLines={1}>
                {status === null ? 'Connect to MorrowBot on your computer' : status.label}
              </Text>
            </View>
          </View>
          <Chevron />
        </Pressable>
      )}
      {sections.length === 0 ? (
        <Note text={`No settings match “${query}”.`} />
      ) : (
        <Group header={null} footer={null}>
          {sections.map((info) => (
            <Row
              key={info.section}
              label={info.label}
              detail={info.section === 'connections' && active !== null ? active.host.hostName : null}
              leading={<IconTile symbol={info.symbol} />}
              trailing={<Chevron />}
              tone="default"
              selected={selectedSection === info.section}
              onPress={() => {
                props.navigation.open({ kind: 'settings', section: info.section });
              }}
            />
          ))}
        </Group>
      )}
      <PairHostSheet />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing[4], gap: spacing[5], paddingBottom: 120 },
  title: { paddingHorizontal: spacing[1] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderRadius: radii.md, height: 40 },
  searchInput: { flex: 1, paddingVertical: 0 },
  hostCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  hostIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  hostText: { flex: 1, gap: 2 },
  hostStatus: { flexDirection: 'row', alignItems: 'center' },
  hostStatusWithDot: { marginLeft: -10 },
});
