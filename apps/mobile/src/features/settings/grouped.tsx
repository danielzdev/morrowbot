import type { SFSymbol } from 'expo-symbols';
import { SymbolView } from 'expo-symbols';
import { Children, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography, type ThemeColors } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { Tone } from './link-status.ts';
import type { Loaded } from './use-host-request.ts';

/** iOS grouped-list pieces in MorrowBot's matte surfaces, shared by the Settings screens. */

export function GroupedScroll(props: { readonly children: ReactNode }) {
  return <ScrollView contentContainerStyle={styles.scroll}>{props.children}</ScrollView>;
}

export function Group(props: { readonly header: string | null; readonly footer: string | null; readonly children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(props.children);
  return (
    <View style={styles.group}>
      {props.header === null ? null : <Text style={[typography.meta, styles.header, { color: colors.text3 }]}>{props.header.toUpperCase()}</Text>}
      <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}>
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 ? <View style={[styles.separator, { backgroundColor: colors.hairline }]} /> : null}
            {row}
          </View>
        ))}
      </View>
      {props.footer === null ? null : <Text style={[typography.small, styles.footer, { color: colors.text3 }]}>{props.footer}</Text>}
    </View>
  );
}

export type RowTone = 'default' | 'accent' | 'destructive';

export function Row(props: {
  readonly label: string;
  readonly detail: string | null;
  readonly leading: ReactNode;
  readonly trailing: ReactNode;
  readonly tone: RowTone;
  readonly selected: boolean;
  readonly onPress: (() => void) | null;
  readonly onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  const labelColor = props.tone === 'accent' ? colors.accent : props.tone === 'destructive' ? colors.danger : colors.text1;
  const content = (
    <>
      {props.leading}
      <View style={styles.rowText}>
        <Text style={[typography.body, { color: labelColor }]} numberOfLines={1}>
          {props.label}
        </Text>
        {props.detail === null ? null : (
          <Text style={[typography.small, { color: colors.text3 }]} numberOfLines={2}>
            {props.detail}
          </Text>
        )}
      </View>
      {props.trailing}
    </>
  );
  if (props.onPress === null) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      {...(props.onLongPress === undefined ? {} : { onLongPress: props.onLongPress })}
      style={({ pressed }) => [styles.row, (pressed || props.selected) && { backgroundColor: colors.selected }]}
    >
      {content}
    </Pressable>
  );
}

export function IconTile(props: { readonly symbol: SFSymbol }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
      <SymbolView name={props.symbol} size={17} tintColor={colors.accent} />
    </View>
  );
}

export function Chevron() {
  const { colors } = useTheme();
  return <SymbolView name="chevron.right" size={13} tintColor={colors.text3} />;
}

export function Check() {
  const { colors } = useTheme();
  return <SymbolView name="checkmark" size={16} tintColor={colors.accent} />;
}

export function toneColor(tone: Tone, colors: ThemeColors): string {
  switch (tone) {
    case 'ok':
      return colors.ok;
    case 'warn':
      return colors.warn;
    case 'danger':
      return colors.danger;
    case 'muted':
      return colors.textDisabled;
  }
}

export function StatusDot(props: { readonly tone: Tone }) {
  const { colors } = useTheme();
  return <View accessibilityElementsHidden style={[styles.dot, { backgroundColor: toneColor(props.tone, colors) }]} />;
}

/** A centred line for loading, empty and error states. */
export function Note(props: { readonly text: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.ui, styles.note, { color: colors.text3 }]}>{props.text}</Text>;
}

/** Loading, no host, or an error, in words; `empty` once loaded with nothing to show. */
export function LoadedNote<T>(props: { readonly loaded: Loaded<T>; readonly empty: string | null }) {
  switch (props.loaded.kind) {
    case 'no-host':
      return <Note text="Pair a host in Connections first." />;
    case 'loading':
      return <Note text="Loading…" />;
    case 'error':
      return <Note text={props.loaded.message} />;
    case 'ready':
      return props.empty === null ? null : <Note text={props.empty} />;
  }
}

const styles = StyleSheet.create({
  scroll: { padding: spacing[4], paddingBottom: 120, gap: spacing[6] },
  group: { gap: spacing[2] },
  header: { paddingHorizontal: spacing[4], letterSpacing: 0.4 },
  footer: { paddingHorizontal: spacing[4] },
  card: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: 52, paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  rowText: { flex: 1, gap: 2 },
  tile: { width: 30, height: 30, borderRadius: radii.sm + 1, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 10 },
  note: { textAlign: 'center', padding: spacing[6] },
});
