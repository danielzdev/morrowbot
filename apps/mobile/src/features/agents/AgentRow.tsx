import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../../lib/relative-time.ts';
import { radii, spacing, typography, type ThemeColors } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { AgentAvatar } from './AgentAvatar.tsx';
import { previewLine, type AgentItem, type AgentStatus } from './agent-groups.ts';

/** The avatar's corner dot: warn for Needs you, accent for unread, none otherwise. */
function dotColor(status: AgentStatus, colors: ThemeColors): string | null {
  switch (status.kind) {
    case 'needs-approval':
    case 'needs-you':
      return colors.warn;
    case 'unread':
      return colors.accent;
    case 'working':
    case 'queued':
    case 'idle':
      return null;
  }
}

/** One agent: avatar, then name and age over the status or last message. */
export function AgentRow(props: {
  readonly item: AgentItem;
  readonly selected: boolean;
  readonly now: number;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const { agent, status, lastMessage } = props.item;
  const line = previewLine(props.item);
  const unread = status.kind === 'unread';
  let preview;
  switch (line.kind) {
    case 'status':
      preview = (
        <View style={styles.status}>
          {line.tone === 'working' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          <Text numberOfLines={1} style={[typography.small, { color: line.tone === 'warn' ? colors.warn : colors.text2 }]}>
            {line.text}
          </Text>
        </View>
      );
      break;
    case 'message':
      preview = (
        <Text numberOfLines={1} style={[typography.small, styles.grow, { color: unread ? colors.text1 : colors.text3 }]}>
          {line.text}
        </Text>
      );
      break;
    case 'empty':
      preview = (
        <Text numberOfLines={1} style={[typography.small, styles.grow, { color: colors.textDisabled }]}>
          No messages yet
        </Text>
      );
      break;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={line.kind === 'status' ? `${agent.name}, ${line.text}` : agent.name}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        (props.selected || pressed) && { backgroundColor: props.selected ? colors.selected : colors.hover },
      ]}
    >
      <AgentAvatar name={agent.name} avatar={agent.avatar} dot={dotColor(status, colors)} />
      <View style={styles.text}>
        <View style={styles.line}>
          <Text numberOfLines={1} style={[typography.ui, styles.grow, styles.name, { color: colors.text1 }]}>
            {agent.name}
          </Text>
          {lastMessage === null ? null : (
            <Text style={[typography.meta, { color: unread ? colors.accent : colors.text3 }]}>
              {relativeTime(lastMessage.at, props.now)}
            </Text>
          )}
        </View>
        <View style={styles.line}>{preview}</View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginHorizontal: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderRadius: radii.md,
  },
  text: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  grow: { flex: 1 },
  name: { fontWeight: '600' },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
});
