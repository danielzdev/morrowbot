import type { Agent } from '@morrowbot/contracts';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { GlassSurface } from '../../lib/GlassSurface.tsx';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { ComposerButton } from './chat-session.ts';
import { ModelEffortPill } from './ModelEffortPill.tsx';

const ROUND = 36;

/** The floating Liquid Glass composer capsule: attachment strip, message box, then attach, Model / Effort pill, Send or Stop. */
export function Composer(props: {
  readonly agent: Agent;
  readonly draft: string;
  readonly button: ComposerButton;
  readonly onDraft: (text: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  /** The attachment strip, shown above the message box. */
  readonly attachments: ReactNode;
  readonly canAttach: boolean;
  readonly onAttach: () => void;
}) {
  const { colors } = useTheme();
  const { button } = props;
  const sending = button.kind === 'send';
  return (
    <GlassSurface interactive style={styles.capsule}>
      {props.attachments}
      <TextInput
        accessibilityLabel="Message"
        multiline
        value={props.draft}
        onChangeText={props.onDraft}
        placeholder={`Message ${props.agent.name}`}
        placeholderTextColor={colors.text3}
        style={[typography.body, styles.input, { color: colors.text1 }]}
      />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach"
          accessibilityHint="Adds photos or files to this message"
          accessibilityState={{ disabled: !props.canAttach }}
          disabled={!props.canAttach}
          hitSlop={6}
          onPress={props.onAttach}
          style={({ pressed }) => [styles.round, { backgroundColor: pressed ? colors.selected : colors.hover }]}
        >
          <SymbolView name="plus" size={17} tintColor={props.canAttach ? colors.text2 : colors.textDisabled} />
        </Pressable>
        <View style={styles.pill}>
          <ModelEffortPill agent={props.agent} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sending ? 'Send' : 'Stop'}
          accessibilityState={{ disabled: !button.enabled }}
          disabled={!button.enabled}
          hitSlop={6}
          onPress={sending ? props.onSend : props.onStop}
          style={[styles.round, { backgroundColor: button.enabled ? colors.accent : colors.selected }]}
        >
          <SymbolView
            name={sending ? 'arrow.up' : 'stop.fill'}
            size={sending ? 17 : 13}
            weight="bold"
            tintColor={button.enabled ? colors.onAccent : colors.textDisabled}
          />
        </Pressable>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  capsule: { borderRadius: radii.xl, paddingHorizontal: spacing[3], paddingTop: spacing[2], paddingBottom: spacing[2], gap: spacing[1] },
  input: { maxHeight: 140, minHeight: 36, paddingHorizontal: spacing[1], paddingTop: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pill: { flex: 1, flexDirection: 'row' },
  round: { width: ROUND, height: ROUND, borderRadius: ROUND / 2, alignItems: 'center', justifyContent: 'center' },
});
