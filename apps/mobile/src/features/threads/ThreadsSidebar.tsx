import { FlatList, StyleSheet } from 'react-native';
import { ListEmpty, ListSearchField, ListTitle, searchQuery, type ListSearch } from '../../lib/ListChrome.tsx';
import { useNow } from '../../lib/relative-time.ts';
import { useStore, type ReadableStore, type Store } from '../../lib/store.ts';
import type { DetailRoute, SidebarProps } from '../../lib/workspace.ts';
import type { Directory } from './directory.ts';
import { FilterPills } from './FilterPills.tsx';
import { listThreads, type ThreadFilter, type ThreadItem } from './thread-groups.ts';
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

/** Every thread across all agents in one list, newest first, narrowed by the filter pills. */
export function ThreadsSidebar(
  props: SidebarProps & {
    readonly directory: ReadableStore<Directory>;
    readonly search: Store<ListSearch>;
    readonly filter: Store<ThreadFilter>;
  },
) {
  const directory = useStore(props.directory);
  const search = useStore(props.search);
  const filter = useStore(props.filter);
  const now = useNow();
  const query = searchQuery(search);
  const items = listThreads(directory, { ...filter, query });
  const filtering = filter.folder.kind !== 'all' || filter.agent.kind !== 'all' || filter.needsYouOnly || query.trim() !== '';
  const { selected, navigation } = props;
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          <ListTitle title="All Threads" />
          <ListSearchField placeholder="Search threads" search={props.search} />
          <FilterPills
            directory={directory}
            filter={filter}
            onChange={(next) => {
              props.filter.update(() => next);
            }}
          />
        </>
      }
      ListEmptyComponent={<ListEmpty text={filtering ? 'No threads match.' : 'No threads yet.'} />}
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
