import { SymbolView } from 'expo-symbols';
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { Directory } from './directory.ts';
import { agentChoices, filterKey, filterLabel, folderChoices, type Choice, type ThreadFilter } from './thread-groups.ts';

function choose<T>(title: string, choices: readonly Choice<T>[], onChoose: (value: T) => void): void {
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...choices.map(({ label }) => label), 'Cancel'], cancelButtonIndex: choices.length },
    (index) => {
      const choice = choices[index];
      if (choice) onChoose(choice.value);
    },
  );
}

function Pill(props: { readonly label: string; readonly active: boolean; readonly menu: boolean; readonly onPress: () => void }) {
  const { colors } = useTheme();
  const tint = props.active ? colors.accent : colors.text2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={[
        styles.pill,
        { borderColor: props.active ? colors.accent : colors.hairlineStrong },
        props.active && { backgroundColor: colors.accentSoft },
      ]}
    >
      <Text style={[typography.small, { color: tint }]}>{props.label}</Text>
      {props.menu ? <SymbolView name="chevron.down" size={10} tintColor={tint} /> : null}
    </Pressable>
  );
}

/** All folders / All agents / Needs you, above the All Threads list. */
export function FilterPills(props: {
  readonly directory: Directory;
  readonly filter: ThreadFilter;
  readonly onChange: (filter: ThreadFilter) => void;
}) {
  const { directory, filter, onChange } = props;
  const folders = folderChoices(directory);
  const agents = agentChoices(directory, filter.folder);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Pill
        label={filterLabel(folders, filter.folder)}
        active={filter.folder.kind !== 'all'}
        menu
        onPress={() => {
          choose('Show threads in', folders, (folder) => {
            if (filterKey(folder) !== filterKey(filter.folder)) onChange({ ...filter, folder, agent: { kind: 'all' } });
          });
        }}
      />
      <Pill
        label={filterLabel(agents, filter.agent)}
        active={filter.agent.kind !== 'all'}
        menu
        onPress={() => {
          choose('Show threads of', agents, (agent) => {
            onChange({ ...filter, agent });
          });
        }}
      />
      <Pill
        label="Needs you"
        active={filter.needsYouOnly}
        menu={false}
        onPress={() => {
          onChange({ ...filter, needsYouOnly: !filter.needsYouOnly });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    height: 32,
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
