import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../lib/useTheme.ts';
import { chooseAppearance, useAppearanceChoice, type AppearanceChoice } from './appearance.ts';
import { Check, Group, GroupedScroll, Row } from './grouped.tsx';

const CHOICES: readonly { readonly choice: AppearanceChoice; readonly label: string; readonly detail: string | null }[] = [
  { choice: 'system', label: 'System', detail: 'Match iOS' },
  { choice: 'light', label: 'Light', detail: null },
  { choice: 'dark', label: 'Dark', detail: null },
];

export function AppearanceScreen() {
  const current = useAppearanceChoice();
  const { colors } = useTheme();
  return (
    <GroupedScroll>
      <Group header="Mode" footer={null}>
        {CHOICES.map(({ choice, label, detail }) => (
          <Row
            key={choice}
            label={label}
            detail={detail}
            leading={null}
            trailing={current === choice ? <Check /> : null}
            tone="default"
            selected={false}
            onPress={() => {
              chooseAppearance(choice);
            }}
          />
        ))}
      </Group>
      <Group header="Accent" footer="MorrowBot uses Dusk violet everywhere, matching the desktop app.">
        <Row
          label="Dusk violet"
          detail={null}
          leading={<View style={[styles.swatch, { backgroundColor: colors.accent }]} />}
          trailing={<Check />}
          tone="default"
          selected={false}
          onPress={null}
        />
      </Group>
    </GroupedScroll>
  );
}

const styles = StyleSheet.create({ swatch: { width: 30, height: 30, borderRadius: 15 } });
