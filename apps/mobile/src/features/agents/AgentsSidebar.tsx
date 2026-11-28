import { useState } from 'react';
import { SectionList, StyleSheet } from 'react-native';
import {
  ListEmpty,
  ListSearchField,
  ListSectionHeader,
  ListTitle,
  searchQuery,
  type ListSearch,
} from '../../lib/ListChrome.tsx';
import { useNow } from '../../lib/relative-time.ts';
import { useStore, type ReadableStore, type Store } from '../../lib/store.ts';
import type { SidebarProps } from '../../lib/workspace.ts';
import { AgentRow } from './AgentRow.tsx';
import { groupAgents, sectionKey, sectionLabel, type AgentItem, type AgentsDirectory, type Section } from './agent-groups.ts';

/** Space for the floating Search pill and the home indicator below the last row. */
const BOTTOM_CLEARANCE = 96;

/** The messenger-style Agents & Folders list. */
export function AgentsSidebar(
  props: SidebarProps & { readonly directory: ReadableStore<AgentsDirectory>; readonly search: Store<ListSearch> },
) {
  const directory = useStore(props.directory);
  const search = useStore(props.search);
  const now = useNow();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const query = searchQuery(search);
  const groups = groupAgents(directory, query);
  const searching = query.trim() !== '';
  const { selected, navigation } = props;
  const sections = groups.map(({ section, items }) => {
    const key = sectionKey(section);
    const isCollapsed = !searching && collapsed.has(key);
    return { key, section, count: items.length, collapsed: isCollapsed, data: isCollapsed ? [] : items };
  });
  const toggle = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  return (
    <SectionList<AgentItem, { readonly key: string; readonly section: Section; readonly count: number; readonly collapsed: boolean }>
      sections={sections}
      keyExtractor={(item) => item.key}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          <ListTitle title="Agents" />
          <ListSearchField placeholder="Search agents" search={props.search} />
        </>
      }
      ListEmptyComponent={<ListEmpty text={searching ? 'No agents match.' : 'No agents yet.'} />}
      renderSectionHeader={({ section }) => (
        <ListSectionHeader
          label={sectionLabel(section.section)}
          count={section.count}
          collapsed={section.collapsed}
          onToggle={() => {
            toggle(section.key);
          }}
        />
      )}
      renderItem={({ item }) => (
        <AgentRow
          item={item}
          now={now}
          selected={selected?.kind === 'chat' && selected.agentId === item.agent.id}
          onPress={() => {
            navigation.open({ kind: 'chat', agentId: item.agent.id, threadId: null });
          }}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({ content: { paddingBottom: BOTTOM_CLEARANCE } });
