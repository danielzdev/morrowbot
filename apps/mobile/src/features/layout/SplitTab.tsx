import { View } from 'react-native';
import { Split } from 'react-native-screens';
import { DETAIL_MIN_WIDTH, type WorkspaceLayout } from '../../lib/layout.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { DetailRegistry, DetailRoute, TabSlot, WorkspaceNavigation } from '../../lib/workspace.ts';
import { DetailPane, type DetailLeading } from './DetailPane.tsx';
import { EmptyDetail } from './EmptyDetail.tsx';
import type { ContentInsets } from './FoldedTab.tsx';
import { SearchPill } from './SearchPill.tsx';

type SplitLayout = Extract<WorkspaceLayout, { readonly kind: 'split' }>;

/** Unfolded: the list sits in a sidebar column beside the detail, meeting on the hinge if any. */
export function SplitTab(props: {
  readonly tab: TabSlot;
  readonly route: DetailRoute | null;
  readonly details: DetailRegistry;
  readonly navigation: WorkspaceNavigation;
  readonly layout: SplitLayout;
  readonly insets: ContentInsets;
  readonly searchBottom: number;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
}) {
  const theme = useTheme();
  const { Sidebar, onSearch } = props.tab;
  const { layout, navigation } = props;
  const leading: DetailLeading = layout.canExpandDetail
    ? { kind: 'expand', expanded: props.expanded, onToggle: props.onToggleExpanded }
    : { kind: 'none' };
  return (
    <Split.Host
      colorScheme={theme.scheme}
      preferredDisplayMode={props.expanded ? 'secondaryOnly' : 'oneBesideSecondary'}
      preferredSplitBehavior="tile"
      displayModeButtonVisibility="never"
      presentsWithGesture={false}
      columnMetrics={{
        minimumPrimaryColumnWidth: layout.sidebarWidth,
        maximumPrimaryColumnWidth: layout.sidebarWidth,
        preferredPrimaryColumnWidthOrFraction: layout.sidebarWidth,
        minimumSecondaryColumnWidth: DETAIL_MIN_WIDTH,
      }}
    >
      <Split.Column disableStackIntegration>
        <View style={{ flex: 1, paddingTop: props.insets.top, paddingLeft: props.insets.left, backgroundColor: theme.colors.surface1 }}>
          <Sidebar selected={props.route} navigation={navigation} />
          {onSearch ? (
            <SearchPill
              bottom={props.searchBottom}
              onPress={() => {
                onSearch(navigation);
              }}
            />
          ) : null}
        </View>
      </Split.Column>
      <Split.Column disableStackIntegration>
        <View
          style={{
            flex: 1,
            paddingTop: props.insets.top,
            paddingLeft: props.expanded ? props.insets.left : layout.gap,
            paddingRight: props.insets.right,
            backgroundColor: theme.colors.surface0,
          }}
        >
          {props.route ? (
            <DetailPane route={props.route} details={props.details} navigation={navigation} leading={leading} />
          ) : (
            <EmptyDetail />
          )}
        </View>
      </Split.Column>
    </Split.Host>
  );
}
