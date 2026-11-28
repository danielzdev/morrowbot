import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../../lib/relative-time.ts';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { ThreadActivity } from './directory.ts';
import type { ThreadItem } from './thread-groups.ts';

/** What the row says about the thread under its title, or null when there is nothing to flag. */
function activityText(activity: ThreadActivity): string | null {
  switch (activity.kind) {
    case 'needs-approval':
      return `Needs approval: ${activity.summary}`;
    case 'failed':
      return 'Failed';
    case 'working':
      return 'Working…';
    case 'queued':
      return 'Queued';
    case 'unread':
    case 'idle':
      return null;
  }
}

function StatusMark(props: { readonly activity: ThreadActivity }) {
  const { colors } = useTheme();
  switch (props.activity.kind) {
    case 'needs-approval':
    case 'failed':
      return <SymbolView name="exclamationmark.circle.fill" size={14} tintColor={colors.warn} />;
    case 'working':
    case 'queued':
      return <ActivityIndicator size="small" color={colors.accent} />;
    case 'unread':
      return <View style={[styles.unread, { backgroundColor: colors.accent }]} />;
    case 'idle':
      return null;
  }
}

/** One thread: its agent's chip, the title over the agent and status, the age at the end. */
export function ThreadRow(props: {
  readonly item: ThreadItem;
  readonly selected: boolean;
  readonly now: number;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const { thread, agent, activity } = props.item;
  const status = activityText(activity);
  const warn = activity.kind === 'needs-approval' || activity.kind === 'failed';
  const unread = activity.kind === 'unread';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={[thread.title, agent.name, status].filter((part) => part !== null).join(', ')}
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
        <Text numberOfLines={2} style={[typography.ui, { color: colors.text1, fontWeight: unread ? '600' : '400' }]}>
          {thread.title}
        </Text>
        <Text numberOfLines={1} style={[typography.small, { color: warn ? colors.warn : colors.text3 }]}>
          {status === null ? agent.name : `${agent.name} · ${status}`}
        </Text>
      </View>
      <View style={styles.trailing}>
        <StatusMark activity={activity} />
        <Text style={[typography.meta, { color: unread ? colors.accent : colors.text3 }]}>
          {relativeTime(thread.updatedAt, props.now)}
        </Text>
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
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], minHeight: 20 },
  unread: { width: 8, height: 8, borderRadius: 4 },
});
