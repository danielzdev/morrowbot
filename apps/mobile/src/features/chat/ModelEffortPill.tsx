import type { Agent, ModelSelection } from '@morrowbot/contracts';
import { SymbolView } from 'expo-symbols';
import { ActionSheetIOS, Pressable, StyleSheet, Text } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { useChatHub } from './chat-context.tsx';
import { modelsOf, pickLabel, pickOf, selectEffort, selectModel, type ModelPick } from './model-pick.ts';
import { useStore } from './store.ts';

export interface AgentModel {
  /** Null while the provider's models load, or when the agent has no provider. */
  readonly pick: ModelPick | null;
  readonly label: string;
  /** Opens the native model and effort menu; null when there is nothing to choose. */
  readonly choose: (() => void) | null;
}

/** The agent's live model and effort, read from its provider on the host, and a menu to change them. */
export function useAgentModel(agent: Agent): AgentModel {
  const hub = useChatHub();
  const binding = agent.provider;
  const info = useStore(hub.providerInfo(binding.kind === 'bound' ? binding.pluginId : ''));
  if (binding.kind === 'unbound') return { pick: null, label: 'No provider', choose: null };
  if (info.kind === 'loading') return { pick: null, label: 'Loading…', choose: null };
  const models = modelsOf(info.kind === 'loaded' ? info.value : null);
  const pick = pickOf(binding.selection, models);
  if (pick === null) return { pick: null, label: 'Provider unavailable', choose: null };
  const save = (selection: ModelSelection): void => {
    void hub.updateAgent(agent.id, { provider: { ...binding, selection } });
  };
  const choose = (): void => {
    const efforts = pick.effort?.option.choices ?? [];
    const mark = (label: string, current: boolean): string => (current ? `${label}  ✓` : label);
    const options = [
      ...models.map((model) => mark(model.label, model.id === pick.model.id)),
      ...efforts.map((choice) => mark(`${pick.effort?.option.label ?? 'Effort'}: ${choice.label}`, choice.id === pick.effort?.choiceId)),
      'Cancel',
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Model and effort', options, cancelButtonIndex: options.length - 1 },
      (index) => {
        const model = models[index];
        if (model !== undefined) {
          save(selectModel(binding.selection, model));
          return;
        }
        const choice = efforts[index - models.length];
        if (choice !== undefined) save(selectEffort(binding.selection, pick, choice.id));
      },
    );
  };
  return { pick, label: pickLabel(pick), choose };
}

/** The composer's Model / Effort pill. */
export function ModelEffortPill(props: { readonly agent: Agent }) {
  const { colors } = useTheme();
  const { label, choose } = useAgentModel(props.agent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model and effort: ${label}`}
      accessibilityState={{ disabled: choose === null }}
      disabled={choose === null}
      onPress={choose ?? undefined}
      hitSlop={6}
      style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? colors.selected : colors.hover, borderColor: colors.hairline }]}
    >
      <Text numberOfLines={1} style={[typography.small, styles.label, { color: colors.text2 }]}>{label}</Text>
      {choose === null ? null : <SymbolView name="chevron.up.chevron.down" size={11} tintColor={colors.text3} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: 32,
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
  },
  label: { fontWeight: '500', flexShrink: 1 },
});
