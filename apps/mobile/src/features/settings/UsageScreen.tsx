import { TokenUsageResponse, type TokenRange, type TokenTotals } from '@morrowbot/contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { Group, GroupedScroll, LoadedNote, Row } from './grouped.tsx';
import { useHostGet } from './use-host-request.ts';

const RANGES: readonly { readonly range: TokenRange; readonly label: string }[] = [
  { range: '24h', label: '24 h' },
  { range: '7d', label: '7 days' },
  { range: '30d', label: '30 days' },
  { range: 'all', label: 'All' },
];

/** Tokens the host counted, per provider and model, over a chosen range. */
export function UsageScreen() {
  const { colors } = useTheme();
  const [range, setRange] = useState<TokenRange>('7d');
  const usage = useHostGet(`/api/usage/tokens?range=${range}`, TokenUsageResponse);
  const groups = usage.kind === 'ready' ? byModel(usage.value.totals) : [];
  return (
    <GroupedScroll>
      <View style={[styles.segments, { backgroundColor: colors.surface3 }]}>
        {RANGES.map((option) => (
          <Pressable
            key={option.range}
            accessibilityRole="tab"
            accessibilityState={{ selected: range === option.range }}
            onPress={() => {
              setRange(option.range);
            }}
            style={[styles.segment, range === option.range && { backgroundColor: colors.surface0 }]}
          >
            <Text style={[typography.small, { color: range === option.range ? colors.text1 : colors.text3, fontWeight: '600' }]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <LoadedNote loaded={usage} empty={groups.length === 0 ? 'No turns in this range.' : null} />
      {groups.length > 0 ? (
        <Group header="Tokens" footer="Counted on the host from what each provider reported. Some providers do not report every count.">
          {groups.map((group) => (
            <Row
              key={group.key}
              label={group.label}
              detail={`${formatCount(group.input)} in · ${formatCount(group.output)} out · ${String(group.turns)} ${group.turns === 1 ? 'turn' : 'turns'}`}
              leading={null}
              trailing={null}
              tone="default"
              selected={false}
              onPress={null}
            />
          ))}
        </Group>
      ) : null}
    </GroupedScroll>
  );
}

interface ModelUsage {
  readonly key: string;
  readonly label: string;
  readonly input: number;
  readonly output: number;
  readonly turns: number;
}

/** Sums every agent's totals per provider and model, busiest first. */
export function byModel(totals: readonly TokenTotals[]): readonly ModelUsage[] {
  const sums = new Map<string, ModelUsage>();
  for (const total of totals) {
    const key = `${total.pluginId}\u0000${total.model ?? ''}`;
    const previous = sums.get(key);
    sums.set(key, {
      key,
      label: total.model === null ? total.pluginId : `${total.pluginId} · ${total.model}`,
      input: (previous?.input ?? 0) + (total.inputTokens ?? 0) + (total.cachedInputTokens ?? 0),
      output: (previous?.output ?? 0) + (total.outputTokens ?? 0),
      turns: (previous?.turns ?? 0) + total.turns,
    });
  }
  return [...sums.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', padding: 3, borderRadius: radii.pill },
  segment: { flex: 1, alignItems: 'center', paddingVertical: spacing[2], borderRadius: radii.pill },
});
