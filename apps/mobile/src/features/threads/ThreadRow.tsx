import { Pressable, StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../../lib/relative-time.ts';
import { RowIndicatorView } from '../../lib/RowIndicator.tsx';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { threadIndicator, type ThreadItem } from './thread-groups.ts';

/** One thread: its agent's chip, the title and age over the agent, with its badge or working dots. */
export function ThreadRow(props: {
  readonly item: ThreadItem;
  readonly selected: boolean;
  readonly now: number;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const { thread, agent, activity } = props.item;
  const indicator = threadIndicator(activity);
  const unread = indicator.kind === 'unread';
  const detail = activity.kind === 'needs-approval' ? `${agent.name} · ${activity.summary}` : agent.name;
  const status = indicator.kind === 'badge' || indicator.kind === 'working' ? indicator.label : unread ? 'Unread' : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={[thread.title, detail, status].filter((part) => part !== null).join(', ')}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        (props.selected || pressed) && { backgroundColor: props.selected ? colors.selected : colors.hover },
      ]}
    >
      <View style={[styles.chip, { backgroundColor: agent.avatar.color }]}>
        <Text style={styles.chipLetter}>{Array.from(agent.name)[0]?.toLocaleUpperCase() ?? ''}</Text>
      </View>
      <View style={styles.text}>
        <View style={styles.line}>
          <Text numberOfLines={2} style={[typography.ui, styles.grow, { color: colors.text1, fontWeight: unread ? '600' : '400' }]}>
            {thread.title}
          </Text>
          <Text style={[typography.meta, { color: unread ? colors.accent : colors.text3 }]}>
            {relativeTime(thread.updatedAt, props.now)}
          </Text>
        </View>
        <View style={styles.line}>
          <Text numberOfLines={1} style={[typography.small, styles.grow, { color: colors.text3 }]}>
            {detail}
          </Text>
          <RowIndicatorView indicator={indicator} />
        </View>
      </View>
    </Pressable>
  );
}

const CHIP = 28;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginHorizontal: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: radii.md,
  },
  chip: { width: CHIP, height: CHIP, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  chipLetter: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  text: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  grow: { flex: 1 },
});
