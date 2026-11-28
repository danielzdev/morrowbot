import type { QueuedMessage, QueuedMessageState } from '@morrowbot/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { QueuedControls } from './composer-controls.ts';

function queueStatus(state: QueuedMessageState, agentName: string): string {
  switch (state.kind) {
    case 'queued':
      return `Queued · ${agentName} hasn't seen it yet`;
    case 'steering':
      return state.via === 'native' ? `Steering · on its way to ${agentName}` : 'Steering · stopping the reply to send it';
    case 'held':
      return state.reason;
  }
}

/** A message the agent has not seen yet, at the end of the chat: its status, then Steer now (or Send now), Edit and Cancel. */
export function QueuedBubble(props: {
  readonly message: QueuedMessage;
  readonly agentName: string;
  readonly controls: QueuedControls;
  readonly onNow: () => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { state } = props.message;
  const edge = state.kind === 'steering' ? colors.accent : colors.hairlineStrong;
  const tone = { queued: colors.text3, steering: colors.accent, held: colors.warn }[state.kind];
  const { controls } = props;
  return (
    <View
      style={[styles.bubble, { backgroundColor: colors.surfaceUser, borderColor: edge, borderStyle: state.kind === 'queued' ? 'dashed' : 'solid' }]}
    >
      <Text accessibilityLiveRegion="polite" style={[typography.meta, { color: tone }]}>{queueStatus(state, props.agentName)}</Text>
      <Text selectable numberOfLines={6} style={[typography.body, { color: colors.text1 }]}>{props.message.text}</Text>
      {controls.kind === 'none' ? null : (
        <View style={styles.actions}>
          <Action label={controls.now.label} tone={state.kind === 'queued' ? 'primary' : 'secondary'} enabled={controls.now.enabled} onPress={props.onNow} />
          <Action label="Edit" hint="Moves it back to the message box" tone="ghost" enabled={controls.editable} onPress={props.onEdit} />
          <Action label="Cancel" hint="Takes it out of the queue" tone="ghost" enabled={controls.editable} onPress={props.onCancel} />
        </View>
      )}
    </View>
  );
}

function Action(props: {
  readonly label: string;
  readonly hint?: string;
  readonly tone: 'primary' | 'secondary' | 'ghost';
  readonly enabled: boolean;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const fill = { primary: colors.primary, secondary: colors.selected, ghost: 'transparent' }[props.tone];
  const ink = { primary: colors.onPrimary, secondary: colors.text1, ghost: colors.text2 }[props.tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: !props.enabled }}
      disabled={!props.enabled}
      hitSlop={4}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: !props.enabled && props.tone !== 'ghost' ? colors.selected : pressed && props.tone === 'ghost' ? colors.hover : fill },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.ui, styles.actionText, { color: props.enabled ? ink : colors.textDisabled }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[1],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[2], marginHorizontal: -spacing[1] },
  action: { minHeight: 36, paddingHorizontal: spacing[3], borderRadius: radii.pill, justifyContent: 'center' },
  actionText: { fontWeight: '600' },
  pressed: { transform: [{ scale: 0.96 }] },
});
