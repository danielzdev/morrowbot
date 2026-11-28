import type { PluginEntry } from '@morrowbot/contracts';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { DetailProps, DetailRoute } from '../../lib/workspace.ts';
import { useExtensions } from './extensions-context.tsx';
import { badgeOf } from './extensions-model.ts';
import { Badge, ItemMark } from './parts.tsx';

function useEntry(extensionId: string): PluginEntry | undefined {
  const { plugins } = useExtensions();
  return plugins.kind === 'loaded' ? plugins.list.plugins.find(({ manifest }) => manifest.id === extensionId) : undefined;
}

export function ExtensionTitle(props: { readonly route: DetailRoute<'extension'> }) {
  const { colors } = useTheme();
  const entry = useEntry(props.route.extensionId);
  return (
    <View style={styles.title}>
      {entry === undefined ? null : <ItemMark name={entry.manifest.name} />}
      <View>
        <Text numberOfLines={1} style={[typography.title, { color: colors.text1 }]}>{entry?.manifest.name ?? props.route.extensionId}</Text>
        <Text style={[typography.small, { color: colors.text3 }]}>Extensions</Text>
      </View>
    </View>
  );
}

function Fact(props: { readonly label: string; readonly value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fact, { borderColor: colors.hairline }]}>
      <Text style={[typography.body, { color: colors.text1 }]}>{props.label}</Text>
      <Text style={[typography.body, styles.value, { color: colors.text3 }]}>{props.value}</Text>
    </View>
  );
}

/** One plugin: its status, what it may touch, and the app-wide on/off switch. */
export function ExtensionBody(props: DetailProps<'extension'>) {
  const { colors } = useTheme();
  const { saving, setEnabled } = useExtensions();
  const entry = useEntry(props.route.extensionId);
  if (entry === undefined) {
    return <Text style={[typography.ui, styles.missing, { color: colors.text3 }]}>This extension is not on the host any more.</Text>;
  }
  const { manifest } = entry;
  const status = entry.status;
  const detail = status.kind === 'unhealthy' || status.kind === 'quarantined' ? status.detail : null;
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Badge badge={badgeOf(status)} />
      {detail === null ? null : <Text style={[typography.small, { color: colors.text2 }]}>{detail}</Text>}
      <View style={[styles.group, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}>
        <View style={[styles.fact, { borderColor: colors.hairline }]}>
          <Text style={[typography.body, styles.value, { color: colors.text1, textAlign: 'left' }]}>On for all agents</Text>
          <Switch
            accessibilityLabel={`${manifest.name} on for all agents`}
            value={entry.enabled}
            disabled={saving.includes(manifest.id)}
            trackColor={{ true: colors.accent }}
            onValueChange={(enabled) => {
              setEnabled(manifest.id, enabled);
            }}
          />
        </View>
        <Fact label="Kind" value={manifest.kind === 'provider' ? 'Provider' : 'Tool'} />
        <Fact label="Version" value={manifest.version} />
        <Fact label="Source" value={entry.source === 'built-in' ? 'Built in' : 'Your plugins folder'} />
        <Fact label="Permissions" value={manifest.permissions.length === 0 ? 'None' : manifest.permissions.join(', ')} />
      </View>
      <Text style={[typography.small, { color: colors.text3 }]}>Change a plugin’s settings on your computer.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  body: { padding: spacing[4], gap: spacing[4] },
  missing: { textAlign: 'center', marginTop: spacing[8] },
  group: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  fact: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing[4], gap: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth },
  value: { flex: 1, textAlign: 'right' },
});
