import type { PluginEntry } from '@morrowbot/contracts';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { SidebarProps } from '../../lib/workspace.ts';
import { useExtensions } from './extensions-context.tsx';
import { badgeOf, SEGMENTS, segmentRows, type ExtensionsSegment } from './extensions-model.ts';
import { Badge, ItemMark } from './parts.tsx';

const EMPTY: Readonly<Record<ExtensionsSegment, string>> = {
  plugins: 'No plugins installed yet.',
  connectors: 'Connect an account so your agents can use it, like your calendar or a to-do app. No connectors are set up yet.',
  marketplace: 'The MorrowBot catalog is not available in this version yet. To add a plugin, put its folder in the host’s plugins folder.',
};

function SegmentBar() {
  const { colors } = useTheme();
  const { segment, setSegment } = useExtensions();
  return (
    <View accessibilityRole="tablist" style={[styles.segments, { backgroundColor: colors.hover }]}>
      {SEGMENTS.map(({ key, label }) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: key === segment }}
          onPress={() => {
            setSegment(key);
          }}
          style={[styles.segment, key === segment && { backgroundColor: colors.surface3 }]}
        >
          <Text style={[typography.small, styles.segmentText, { color: key === segment ? colors.text1 : colors.text3 }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PluginRow(props: { readonly entry: PluginEntry; readonly selected: boolean; readonly onOpen: () => void }) {
  const { colors } = useTheme();
  const { saving, setEnabled, refused } = useExtensions();
  const { manifest } = props.entry;
  const problem = refused[manifest.id];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onOpen}
      style={({ pressed }) => [styles.row, (pressed || props.selected) && { backgroundColor: colors.selected }]}
    >
      <ItemMark name={manifest.name} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[typography.body, styles.name, { color: colors.text1 }]}>{manifest.name}</Text>
        <Badge badge={badgeOf(props.entry.status)} />
        {problem === undefined ? null : <Text style={[typography.small, { color: colors.danger }]}>{problem}</Text>}
      </View>
      <Switch
        accessibilityLabel={`${manifest.name} on for all agents`}
        value={props.entry.enabled}
        disabled={saving.includes(manifest.id)}
        trackColor={{ true: colors.accent }}
        onValueChange={(enabled) => {
          setEnabled(manifest.id, enabled);
        }}
      />
    </Pressable>
  );
}

/** Extensions: Plugins | Connectors | Marketplace, with status badges and on/off toggles. */
export function ExtensionsList(props: SidebarProps) {
  const { colors } = useTheme();
  const { plugins, segment, reload } = useExtensions();
  const [query, setQuery] = useState('');
  const selectedId = props.selected?.kind === 'extension' ? props.selected.extensionId : null;
  const rows = plugins.kind === 'loaded' ? segmentRows(plugins.list.plugins, segment, query) : [];
  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      <Text style={[typography.largeTitle, { color: colors.text1 }]}>Extensions</Text>
      <SegmentBar />
      {segment === 'connectors' ? null : (
        <TextInput
          accessibilityLabel="Search extensions"
          value={query}
          onChangeText={setQuery}
          placeholder={segment === 'marketplace' ? 'Search or browse' : 'Search plugins'}
          placeholderTextColor={colors.text3}
          clearButtonMode="while-editing"
          style={[typography.ui, styles.search, { backgroundColor: colors.hover, color: colors.text1 }]}
        />
      )}
      {plugins.kind === 'loaded' && plugins.list.safeMode ? (
        <Text style={[typography.small, { color: colors.warn }]}>Safe mode: extensions are off until the host restarts normally.</Text>
      ) : null}
      {plugins.kind === 'loading' ? <Text style={[typography.ui, { color: colors.text3 }]}>Loading extensions…</Text> : null}
      {plugins.kind === 'failed' ? (
        <Pressable accessibilityRole="button" onPress={reload}>
          <Text style={[typography.ui, { color: colors.danger }]}>{plugins.message} Tap to try again.</Text>
        </Pressable>
      ) : null}
      {segment === 'marketplace' && plugins.kind === 'loaded' ? (
        <Text style={[typography.small, { color: colors.text3 }]}>{EMPTY.marketplace}</Text>
      ) : null}
      {segment === 'marketplace' && rows.length > 0 ? (
        <Text style={[typography.meta, { color: colors.text3 }]}>INSTALLED</Text>
      ) : null}
      {rows.map((entry) => (
        <PluginRow
          key={entry.manifest.id}
          entry={entry}
          selected={entry.manifest.id === selectedId}
          onOpen={() => {
            props.navigation.open({ kind: 'extension', extensionId: entry.manifest.id });
          }}
        />
      ))}
      {plugins.kind === 'loaded' && rows.length === 0 && segment !== 'marketplace' ? (
        <Text style={[typography.ui, { color: colors.text3 }]}>{query.trim() === '' ? EMPTY[segment] : 'No matches.'}</Text>
      ) : null}
      {segment === 'plugins' && rows.length > 0 ? (
        <Text style={[typography.small, { color: colors.text3 }]}>Turn off a plugin for every agent here, or open one to toggle per agent.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing[4], gap: spacing[3], paddingBottom: 120 },
  segments: { flexDirection: 'row', borderRadius: radii.md, padding: 2 },
  segment: { flex: 1, minHeight: 32, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontWeight: '600' },
  search: { minHeight: 40, borderRadius: radii.md, paddingHorizontal: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radii.lg },
  rowText: { flex: 1, gap: spacing[1] },
  name: { fontWeight: '600' },
});
