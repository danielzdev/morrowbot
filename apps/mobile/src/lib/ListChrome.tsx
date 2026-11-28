import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createStore, useStore, type Store } from './store.ts';
import { radii, spacing, typography } from './theme.ts';
import { useTheme } from './useTheme.ts';

/** A list's large title, as at the top of the Agents and All Threads lists. */
export function ListTitle(props: { readonly title: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.largeTitle, styles.title, { color: colors.text1 }]}>{props.title}</Text>;
}

/** A collapsible section header: label, count while collapsed, a rule and a chevron. */
export function ListSectionHeader(props: {
  readonly label: string;
  readonly count: number;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) {
  const { colors } = useTheme();
  const label = props.collapsed ? `${props.label} (${String(props.count)})` : props.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !props.collapsed }}
      accessibilityLabel={`${props.label}, ${String(props.count)}`}
      onPress={props.onToggle}
      style={styles.header}
    >
      <Text style={[typography.small, styles.headerLabel, { color: colors.text3 }]}>{label}</Text>
      <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
      <SymbolView name={props.collapsed ? 'chevron.down' : 'chevron.up'} size={12} tintColor={colors.text3} />
    </Pressable>
  );
}

/** Collapsed section keys, kept outside the list so they survive folding and unfolding. */
export function toggleCollapsed<K>(collapsed: Store<ReadonlySet<K>>, key: K): void {
  collapsed.update((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
}

/** A list's search: closed, or open with what has been typed so far. */
export type ListSearch = { readonly kind: 'closed' } | { readonly kind: 'open'; readonly query: string };

export function createListSearch(): Store<ListSearch> {
  return createStore<ListSearch>({ kind: 'closed' });
}

/** What Search (the pill or the rail button) does: opens the field, keeping any query. */
export function openListSearch(search: Store<ListSearch>): void {
  search.update((current) => (current.kind === 'open' ? current : { kind: 'open', query: '' }));
}

export function searchQuery(search: ListSearch): string {
  return search.kind === 'open' ? search.query : '';
}

/** The search field a list shows once Search is pressed; Cancel closes it and clears the query. */
export function ListSearchField(props: { readonly placeholder: string; readonly search: Store<ListSearch> }) {
  const { colors } = useTheme();
  const state = useStore(props.search);
  if (state.kind === 'closed') return null;
  return (
    <View style={styles.search}>
      <View style={[styles.field, { backgroundColor: colors.selected }]}>
        <SymbolView name="magnifyingglass" size={15} tintColor={colors.text3} />
        <TextInput
          autoFocus
          value={state.query}
          onChangeText={(query) => {
            props.search.update(() => ({ kind: 'open', query }));
          }}
          placeholder={props.placeholder}
          placeholderTextColor={colors.text3}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          style={[typography.ui, styles.input, { color: colors.text1 }]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          props.search.update(() => ({ kind: 'closed' }));
        }}
        hitSlop={8}
      >
        <Text style={[typography.ui, { color: colors.accent }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** What a list says when nothing matches or nothing exists yet. */
export function ListEmpty(props: { readonly text: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.ui, styles.empty, { color: colors.text3 }]}>{props.text}</Text>;
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  headerLabel: { fontWeight: '500' },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    height: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radii.md,
  },
  input: { flex: 1, paddingVertical: 0 },
  empty: { textAlign: 'center', padding: spacing[6] },
});
