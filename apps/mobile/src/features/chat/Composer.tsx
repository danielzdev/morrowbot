import type { Agent } from '@morrowbot/contracts';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { GlassSurface } from '../../lib/GlassSurface.tsx';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { ComposerButtons } from './composer-controls.ts';
import { ModelEffortPill } from './ModelEffortPill.tsx';

const ROUND = 36;

/** The floating Liquid Glass composer capsule: attach, message box, Model / Effort pill, then Stop and Send (Queue while a reply runs). */
export function Composer(props: {
  readonly agent: Agent;
  readonly draft: string;
  readonly buttons: ComposerButtons;
  readonly onDraft: (text: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
}) {
  const { colors } = useTheme();
  const { buttons } = props;
  return (
    <GlassSurface interactive style={styles.capsule}>
      <TextInput
        accessibilityLabel="Message"
        multiline
        value={props.draft}
        onChangeText={props.onDraft}
        placeholder={buttons.stop === null ? `Message ${props.agent.name}` : `Queue a message for ${props.agent.name}`}
        placeholderTextColor={colors.text3}
        style={[typography.body, styles.input, { color: colors.text1 }]}
      />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach"
          hitSlop={6}
          onPress={() => {
            Alert.alert('Attachments', 'Attaching files from this phone is coming in a later update.');
          }}
          style={({ pressed }) => [styles.round, { backgroundColor: pressed ? colors.selected : colors.hover }]}
        >
          <SymbolView name="plus" size={17} tintColor={colors.text2} />
        </Pressable>
        <View style={styles.pill}>
          <ModelEffortPill agent={props.agent} />
        </View>
        {buttons.stop === null ? null : (
          <RoundButton label="Stop" symbol="stop.fill" size={13} tone="danger" enabled={buttons.stop.enabled} onPress={props.onStop} />
        )}
        {buttons.send === null ? null : (
          <RoundButton
            label={buttons.send.kind === 'send' ? 'Send' : 'Queue'}
            hint={buttons.send.kind === 'queue' ? 'Sent after this reply, or when you tap Steer now' : undefined}
            symbol="arrow.up"
            size={17}
            tone="primary"
            enabled={buttons.send.enabled}
            onPress={props.onSend}
          />
        )}
      </View>
    </GlassSurface>
  );
}

function RoundButton(props: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly symbol: 'stop.fill' | 'arrow.up';
  readonly size: number;
  readonly tone: 'primary' | 'danger';
  readonly enabled: boolean;
  readonly onPress: () => void;
}) {
  const { colors } = useTheme();
  const fill = props.tone === 'primary' ? colors.primary : colors.danger;
  const ink = props.tone === 'primary' ? colors.onPrimary : colors.onDanger;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: !props.enabled }}
      disabled={!props.enabled}
      hitSlop={6}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: !props.enabled ? colors.selected : pressed && props.tone === 'primary' ? colors.primaryHover : fill },
        pressed && styles.pressed,
      ]}
    >
      <SymbolView name={props.symbol} size={props.size} weight="bold" tintColor={props.enabled ? ink : colors.textDisabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsule: { borderRadius: radii.xl, paddingHorizontal: spacing[3], paddingTop: spacing[2], paddingBottom: spacing[2], gap: spacing[1] },
  input: { maxHeight: 140, minHeight: 36, paddingHorizontal: spacing[1], paddingTop: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pill: { flex: 1, flexDirection: 'row' },
  pressed: { transform: [{ scale: 0.96 }] },
  round: { width: ROUND, height: ROUND, borderRadius: ROUND / 2, alignItems: 'center', justifyContent: 'center' },
});
