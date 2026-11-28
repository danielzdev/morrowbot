import { StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { StatusBadge } from './extensions-model.ts';

export function Badge(props: { readonly badge: StatusBadge }) {
  const { colors } = useTheme();
  const color = { ok: colors.ok, muted: colors.text3, warn: colors.warn, danger: colors.danger }[props.badge.tone];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[typography.meta, { color }]}>{props.badge.label}</Text>
    </View>
  );
}

/** The plugin's initial in a rounded square, like desktop's item mark. */
export function ItemMark(props: { readonly name: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.mark, { backgroundColor: colors.accentSoft }]}>
      <Text style={[typography.body, styles.markText, { color: colors.accent }]}>{props.name.slice(0, 1).toLocaleUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  mark: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  markText: { fontWeight: '700' },
});
