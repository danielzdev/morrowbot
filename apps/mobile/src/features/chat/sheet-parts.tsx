import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** A titled group of rows, iOS Settings style. */
export function Section(props: { readonly title: string; readonly footer?: string; readonly children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[typography.meta, styles.sectionTitle, { color: colors.text3 }]}>{props.title.toLocaleUpperCase()}</Text>
      <View style={[styles.group, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}>{props.children}</View>
      {props.footer === undefined ? null : <Text style={[typography.small, styles.footer, { color: colors.text3 }]}>{props.footer}</Text>}
    </View>
  );
}

/** One row: a label, then a value or control. Tappable when `onPress` is given. */
export function Row(props: {
  readonly label: string;
  readonly value?: string;
  readonly tone?: 'normal' | 'accent' | 'danger';
  readonly onPress?: () => void;
  readonly children?: ReactNode;
}) {
  const { colors } = useTheme();
  const color = { normal: colors.text1, accent: colors.accent, danger: colors.danger }[props.tone ?? 'normal'];
  const content = (
    <>
      <Text style={[typography.body, styles.label, { color }]}>{props.label}</Text>
      {props.value === undefined ? null : (
        <Text numberOfLines={1} style={[typography.body, styles.value, { color: colors.text3 }]}>{props.value}</Text>
      )}
      {props.children}
    </>
  );
  if (props.onPress === undefined) return <View style={[styles.row, { borderColor: colors.hairline }]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, { borderColor: colors.hairline }, pressed && { backgroundColor: colors.selected }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  sectionTitle: { paddingHorizontal: spacing[4] },
  group: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  footer: { paddingHorizontal: spacing[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: 48,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flexShrink: 0 },
  value: { flex: 1, textAlign: 'right' },
});
