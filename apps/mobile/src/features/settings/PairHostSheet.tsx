import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { pairProblem, useHostConnection } from '../../lib/host-connection.ts';
import { parsePairingFields, parsePairingLink, type PairingInput } from '../../lib/pairing-link.ts';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { QrScanner } from './QrScanner.tsx';
import { settingsUi, useSettingsUi } from './settings-store.ts';

type Method = 'scan' | 'type';
const METHODS: readonly Method[] = ['scan', 'type'];
type Step = { readonly kind: 'editing' } | { readonly kind: 'pairing' } | { readonly kind: 'problem'; readonly message: string };

/** Adds a host: scan the desktop's pairing QR, or type its address and 6-digit code. */
export function PairHostSheet() {
  const { colors, scheme } = useTheme();
  const ui = useSettingsUi();
  const connection = useHostConnection();
  const [method, setMethod] = useState<Method>('scan');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'editing' });

  const close = (): void => {
    settingsUi.closePairing();
    setStep({ kind: 'editing' });
    setCode('');
  };
  const submit = (input: PairingInput): void => {
    if (step.kind === 'pairing') return;
    if (input.kind === 'invalid') {
      setStep({ kind: 'problem', message: input.problem });
      return;
    }
    setStep({ kind: 'pairing' });
    void connection.pair(input.target).then((outcome) => {
      const problem = pairProblem(outcome);
      if (problem === null) close();
      else setStep({ kind: 'problem', message: problem });
    });
  };

  const field = [styles.field, typography.body, { color: colors.text1, backgroundColor: colors.surface2, borderColor: colors.hairlineStrong }];
  return (
    <Modal visible={ui.pairing === 'open'} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={[styles.fill, { backgroundColor: colors.surface1 }]}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
            <Text style={[typography.body, { color: colors.accent }]}>Cancel</Text>
          </Pressable>
          <Text style={[typography.body, styles.title, { color: colors.text1 }]}>Add Host</Text>
          <View style={styles.topSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[typography.ui, { color: colors.text2 }]}>
            Open MorrowBot on your computer and show a pairing code. This phone and the computer must share a network or a Tailscale tailnet.
          </Text>
          <View style={[styles.segments, { backgroundColor: colors.surface3 }]}>
            {METHODS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: method === option }}
                onPress={() => {
                  setMethod(option);
                  setStep({ kind: 'editing' });
                }}
                style={[styles.segment, method === option && { backgroundColor: colors.surface0 }]}
              >
                <Text style={[typography.ui, { color: method === option ? colors.text1 : colors.text3, fontWeight: '600' }]}>
                  {option === 'scan' ? 'Scan QR Code' : 'Enter Code'}
                </Text>
              </Pressable>
            ))}
          </View>
          {method === 'scan' ? (
            ui.pairing === 'open' ? (
              <QrScanner
                onScan={(text) => {
                  submit(parsePairingLink(text));
                }}
              />
            ) : null
          ) : (
            <View style={styles.form}>
              <Text style={[typography.meta, { color: colors.text3 }]}>HOST ADDRESS</Text>
              <TextInput
                accessibilityLabel="Host address"
                value={url}
                onChangeText={setUrl}
                placeholder="100.64.0.1:47800"
                placeholderTextColor={colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                keyboardAppearance={scheme}
                returnKeyType="next"
                style={field}
              />
              <Text style={[typography.meta, { color: colors.text3 }]}>PAIRING CODE</Text>
              <TextInput
                accessibilityLabel="Pairing code"
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.text3}
                keyboardType="number-pad"
                keyboardAppearance={scheme}
                textContentType="oneTimeCode"
                maxLength={7}
                style={[field, styles.code]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={step.kind === 'pairing'}
                onPress={() => {
                  submit(parsePairingFields(url, code));
                }}
                style={[styles.pair, { backgroundColor: colors.accent, opacity: step.kind === 'pairing' ? 0.6 : 1 }]}
              >
                {step.kind === 'pairing' ? <ActivityIndicator color={colors.onAccent} /> : null}
                <Text style={[typography.body, { color: colors.onAccent, fontWeight: '600' }]}>Pair</Text>
              </Pressable>
            </View>
          )}
          <StepNote step={step} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StepNote(props: { readonly step: Step }) {
  const { colors } = useTheme();
  switch (props.step.kind) {
    case 'editing':
      return null;
    case 'pairing':
      return <Text style={[typography.ui, styles.note, { color: colors.text2 }]}>Pairing…</Text>;
    case 'problem':
      return (
        <Text accessibilityRole="alert" style={[typography.ui, styles.note, { color: colors.danger }]}>
          {props.step.message}
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[4] },
  title: { flex: 1, textAlign: 'center', fontWeight: '600' },
  topSpacer: { width: 56 },
  body: { padding: spacing[5], gap: spacing[5] },
  segments: { flexDirection: 'row', padding: 3, borderRadius: radii.pill },
  segment: { flex: 1, alignItems: 'center', paddingVertical: spacing[2], borderRadius: radii.pill },
  form: { gap: spacing[2] },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  code: { letterSpacing: 6, fontVariant: ['tabular-nums'] },
  pair: { marginTop: spacing[4], flexDirection: 'row', gap: spacing[2], alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[3] + 2, borderRadius: radii.pill },
  note: { textAlign: 'center' },
});
