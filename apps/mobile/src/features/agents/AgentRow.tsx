import { Pressable, StyleSheet, Text, View } from 'react-native';
import { relativeTime } from '../../lib/relative-time.ts';
import { BotAvatar } from '../../lib/bot-avatar/index.ts';
import { RowIndicatorView } from '../../lib/RowIndicator.tsx';
import { AVATAR_SIZE, radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { agentIndicator, previewText, type AgentItem } from './agent-groups.ts';

/** One agent: avatar, then name and age over the last message, with its badge or working dots. */
export function AgentRow(props: {
  readonly item: AgentItem;
  readonly selected: boolean;
  readonly now: number;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const { agent, status, lastMessage } = props.item;
  const indicator = agentIndicator(status);
  const preview = previewText(lastMessage);
  const unread = indicator.kind === 'unread';
  const label = indicator.kind === 'badge' || indicator.kind === 'working' ? `${agent.name}, ${indicator.label}` : agent.name;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={unread ? `${label}, unread` : label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        (props.selected || pressed) && { backgroundColor: props.selected ? colors.selected : colors.hover },
      ]}
    >
      <BotAvatar avatar={agent.avatar} size={AVATAR_SIZE} />
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
        <View style={styles.line}>
          <Text
            numberOfLines={1}
            style={[typography.small, styles.grow, { color: preview === null ? colors.textDisabled : unread ? colors.text1 : colors.text3 }]}
          >
            {preview ?? 'No messages yet'}
          </Text>
          <RowIndicatorView indicator={indicator} />
        </View>
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
});
