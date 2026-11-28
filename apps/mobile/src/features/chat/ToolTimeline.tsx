import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { ToolStep } from './thread-view.ts';

const OUTCOME_WORDS: Readonly<Record<ToolStep['outcome'], string>> = {
  running: 'Running',
  ok: 'Done',
  error: 'Failed',
  unfinished: 'Did not finish',
  unknown: 'Result not seen',
};

/** "Running search_notes", "3 tools · 1 failed". */
export function timelineSummary(steps: readonly ToolStep[]): string {
  const running = steps.find(({ outcome }) => outcome === 'running');
  if (running !== undefined) return `Running ${running.name}`;
  const failed = steps.filter(({ outcome }) => outcome === 'error').length;
  const count = steps.length === 1 ? '1 tool' : `${String(steps.length)} tools`;
  return failed === 0 ? count : `${count} · ${String(failed)} failed`;
}

function inputPreview(input: unknown): string {
  const text = JSON.stringify(input);
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/** A turn's tool calls as one card: the summary line, tapped open to each call and its input. */
export function ToolTimeline(props: { readonly steps: readonly ToolStep[] }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (props.steps.length === 0) return null;
  const tone = (outcome: ToolStep['outcome']): string => {
    switch (outcome) {
      case 'running':
        return colors.accent;
      case 'ok':
        return colors.ok;
      case 'error':
        return colors.danger;
      case 'unfinished':
      case 'unknown':
        return colors.text3;
    }
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Tool calls: ${timelineSummary(props.steps)}`}
        onPress={() => {
          setOpen(!open);
        }}
        style={styles.header}
      >
        <SymbolView name="wrench.and.screwdriver" size={15} tintColor={colors.text3} />
        <Text style={[typography.ui, styles.summary, { color: colors.text2 }]}>{timelineSummary(props.steps)}</Text>
        <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={13} tintColor={colors.text3} />
      </Pressable>
      {open
        ? props.steps.map((step) => (
            <View key={step.toolUseId} style={[styles.row, { borderColor: colors.hairline }]}>
              <View style={[styles.dot, { backgroundColor: tone(step.outcome) }]} />
              <View style={styles.rowText}>
                <Text style={[typography.ui, { color: colors.text1 }]}>
                  {step.name} <Text style={{ color: colors.text3 }}>· {OUTCOME_WORDS[step.outcome]}</Text>
                </Text>
                <Text numberOfLines={2} style={[typography.meta, styles.mono, { color: colors.text3 }]}>
                  {inputPreview(step.input)}
                </Text>
              </View>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], minHeight: 44 },
  summary: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing[3], padding: spacing[3], borderTopWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  rowText: { flex: 1, gap: 2 },
  mono: { fontFamily: 'Menlo' },
});
