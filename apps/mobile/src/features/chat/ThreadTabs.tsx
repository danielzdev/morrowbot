import { createdBefore, mainThread, type Thread } from '@morrowbot/contracts';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';

/** The pinned main chat first, then the agent's other threads, newest first. */
export function threadTabs(threads: readonly Thread[]): readonly Thread[] {
  const main = mainThread(threads);
  const rest = threads.filter((thread) => thread !== main).sort((a, b) => (createdBefore(a, b) ? 1 : createdBefore(b, a) ? -1 : 0));
  return main === null ? rest : [main, ...rest];
}

/** A compact horizontal switcher between an agent's threads. */
export function ThreadTabs(props: {
  readonly threads: readonly Thread[];
  readonly currentId: string;
  readonly onSelect: (thread: Thread, isMain: boolean) => void;
}) {
  const { colors } = useTheme();
  const tabs = threadTabs(props.threads);
  if (tabs.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.strip}>
      {tabs.map((thread, index) => {
        const current = thread.id === props.currentId;
        const isMain = index === 0;
        return (
          <Pressable
            key={thread.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: current }}
            onPress={() => {
              props.onSelect(thread, isMain);
            }}
            style={[styles.tab, { backgroundColor: current ? colors.accentSoft : colors.hover, borderColor: current ? colors.accent : colors.hairline }]}
          >
            {isMain ? <SymbolView name="pin.fill" size={11} tintColor={current ? colors.accent : colors.text3} /> : null}
            <Text numberOfLines={1} style={[typography.small, styles.label, { color: current ? colors.accent : colors.text2 }]}>
              {isMain ? 'Main' : thread.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0 },
  strip: { gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: 32,
    maxWidth: 180,
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontWeight: '500' },
});
