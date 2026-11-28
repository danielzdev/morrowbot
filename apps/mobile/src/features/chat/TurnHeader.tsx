import type { AgentAvatar } from '@morrowbot/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { LiveBotAvatar, type AvatarActivity } from '../../lib/bot-avatar/index.ts';
import { spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** The chat's avatar beside a turn, as on desktop. */
export const TURN_AVATAR_SIZE = 32;

/**
 * The agent's moving avatar and what it is doing, at the top of the running turn or of the reply during its
 * completion beat. The chat drops it when the turn is over, which stops its frames.
 */
export function TurnHeader(props: {
  readonly avatar: AgentAvatar;
  readonly activity: AvatarActivity;
  readonly label: string;
  readonly detail: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <LiveBotAvatar avatar={props.avatar} size={TURN_AVATAR_SIZE} activity={props.activity} />
      <Text numberOfLines={2} style={[typography.ui, styles.text, { color: colors.text3 }]}>
        <Text style={[styles.label, { color: colors.text2 }]}>{props.label}</Text>
        {props.detail === null ? null : ` · ${props.detail}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: TURN_AVATAR_SIZE },
  text: { flex: 1 },
  label: { fontWeight: '500' },
});
