import type { ApprovalChoice } from '@morrowbot/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { ApprovalEnding, ApprovalStep } from './thread-view.ts';

/** Deny-style choices first; Allow last and primary, under the thumb. */
const ordered = (choices: readonly ApprovalChoice[]): ApprovalChoice[] =>
  [...choices].sort((a, b) => Number(a.id === 'allow') - Number(b.id === 'allow'));

export function endingCopy(ending: ApprovalEnding): string {
  switch (ending.kind) {
    case 'chosen':
      return `You chose ${ending.label}.`;
    case 'expired':
      return 'This request timed out.';
    case 'cleared':
      return 'This request ended with the reply.';
    case 'late':
      return 'This request had already ended.';
  }
}

/** An approval request inline in its turn: big buttons while pending, then its ending as text. */
export function ApprovalCard(props: {
  readonly step: ApprovalStep;
  readonly sending: boolean;
  readonly onAnswer: (choiceId: string) => void;
}) {
  const { colors } = useTheme();
  const { approval, ending } = props.step;
  return (
    <View
      accessibilityRole="summary"
      style={[styles.card, { backgroundColor: colors.surface2, borderColor: ending === null ? colors.accent : colors.hairline }]}
    >
      <Text style={[typography.meta, { color: ending === null ? colors.accent : colors.text3 }]}>
        {ending === null ? 'NEEDS YOU' : 'APPROVAL'}
      </Text>
      <Text style={[typography.body, styles.summary, { color: colors.text1 }]}>{approval.summary.replaceAll('`', '')}</Text>
      {ending === null ? (
        <View style={styles.buttons}>
          {ordered(approval.choices).map((choice) => {
            const primary = choice.id === 'allow';
            return (
              <Pressable
                key={choice.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: props.sending }}
                disabled={props.sending}
                onPress={() => {
                  props.onAnswer(choice.id);
                }}
                style={({ pressed }) => [
                  styles.button,
                  primary
                    ? { backgroundColor: pressed ? colors.accentPressed : colors.accent }
                    : { backgroundColor: pressed ? colors.selected : colors.surface3, borderColor: colors.hairlineStrong, borderWidth: 1 },
                  props.sending && styles.disabled,
                ]}
              >
                <Text style={[typography.body, styles.label, { color: primary ? colors.onAccent : colors.text1 }]}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[typography.ui, { color: colors.text2 }]}>{endingCopy(ending)}</Text>
      )}
      {props.sending ? <Text style={[typography.small, { color: colors.text3 }]}>Sending…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, borderWidth: 1.5, padding: spacing[4], gap: spacing[2] },
  summary: { fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] },
  button: { flex: 1, minHeight: 52, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
