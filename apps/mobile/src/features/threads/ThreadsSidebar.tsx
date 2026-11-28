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
import type { DetailRoute, SidebarProps } from '../../lib/workspace.ts';
import type { Directory } from './directory.ts';
import { FilterPills } from './FilterPills.tsx';
import { NO_FILTER, THREAD_GROUP_LABELS, groupThreads, type ThreadGroupKind, type ThreadItem } from './thread-groups.ts';
import { ThreadRow } from './ThreadRow.tsx';

/** Space for the floating Search pill and the home indicator below the last row. */
const BOTTOM_CLEARANCE = 96;

/** The chat route for a thread; an agent's main chat is `threadId: null`, as the Agents list opens it. */
function routeOf(item: ThreadItem): DetailRoute {
  return { kind: 'chat', agentId: item.agent.id, threadId: item.isMain ? null : item.thread.id };
}

function isSelected(selected: DetailRoute | null, item: ThreadItem): boolean {
  if (selected?.kind !== 'chat' || selected.agentId !== item.agent.id) return false;
  return selected.threadId === item.thread.id || (selected.threadId === null && item.isMain);
}

/** Every thread across all agents: Needs you, Working, Recent. */
export function ThreadsSidebar(
  props: SidebarProps & { readonly directory: ReadableStore<Directory>; readonly search: Store<ListSearch> },
) {
  const directory = useStore(props.directory);
  const search = useStore(props.search);
  const now = useNow();
  const [filter, setFilter] = useState(NO_FILTER);
  const [collapsed, setCollapsed] = useState<ReadonlySet<ThreadGroupKind>>(new Set());
  const query = searchQuery(search);
  const narrowed = { ...filter, query };
  const groups = groupThreads(directory, narrowed);
  const sections = groups.map(({ kind, items }) => ({
    key: kind,
    count: items.length,
    collapsed: collapsed.has(kind),
    data: collapsed.has(kind) ? [] : items,
  }));
  const filtering = filter.folder.kind !== 'all' || filter.agent.kind !== 'all' || filter.needsYouOnly || query.trim() !== '';
  const { selected, navigation } = props;
  return (
    <SectionList<ThreadItem, { readonly key: ThreadGroupKind; readonly count: number; readonly collapsed: boolean }>
      sections={sections}
      keyExtractor={(item) => item.key}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          <ListTitle title="All Threads" />
          <ListSearchField placeholder="Search threads" search={props.search} />
          <FilterPills directory={directory} filter={filter} onChange={setFilter} />
        </>
      }
      ListEmptyComponent={<ListEmpty text={filtering ? 'No threads match.' : 'No threads yet.'} />}
      renderSectionHeader={({ section }) => (
        <ListSectionHeader
          label={THREAD_GROUP_LABELS[section.key]}
          count={section.count}
          collapsed={section.collapsed}
          onToggle={() => {
            setCollapsed((current) => {
              const next = new Set(current);
              if (!next.delete(section.key)) next.add(section.key);
              return next;
            });
          }}
        />
      )}
      renderItem={({ item }) => (
        <ThreadRow
          item={item}
          now={now}
          selected={isSelected(selected, item)}
          onPress={() => {
            navigation.open(routeOf(item));
          }}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({ content: { paddingBottom: BOTTOM_CLEARANCE } });
