import { View } from 'react-native';
import { deriveActionSlotPlacement, deriveWorkspaceLayout } from '../../lib/layout.ts';
import { deriveBottomControlInsets, type NativeLayoutMetrics } from '../../lib/reserved-regions.ts';
import { ACTION_PRESETS } from '../../lib/symbols.ts';
import {
  detailSlotFor,
  type SlotAction,
  type TabKey,
  type WorkspaceNavigation,
  type WorkspaceRegistry,
} from '../../lib/workspace.ts';
import { ActionSlot } from './ActionSlot.tsx';
import { FoldedTab } from './FoldedTab.tsx';
import { SplitTab } from './SplitTab.tsx';
import { deriveActionSource, isDetailExpanded, type WorkspaceState } from './workspace-state.ts';

/** One tab of the rail: folded stack or unfolded split, with its floating actions on top. */
export function TabContent(props: {
  readonly tabKey: TabKey;
  readonly state: WorkspaceState;
  readonly metrics: NativeLayoutMetrics | null;
  readonly registry: WorkspaceRegistry;
  readonly navigation: WorkspaceNavigation;
  readonly onToggleExpanded: () => void;
}) {
  const { metrics, registry, navigation, state } = props;
  const tab = registry.tabs[props.tabKey];
  const route = state.selection[props.tabKey];
  const layout = deriveWorkspaceLayout(metrics);
  const source = deriveActionSource(layout.kind, route);
  const actions: readonly SlotAction[] =
    source.kind === 'detail'
      ? detailSlotFor(registry.details, source.route).actions(source.route)
      : [
          ...tab.actions,
          ...(source.includeSearch && tab.onSearch ? [{ id: 'search', ...ACTION_PRESETS.search, onPress: tab.onSearch }] : []),
        ];
  const top = metrics?.safeArea.top ?? 0;

  let body;
  switch (layout.kind) {
    case 'stack':
      body = (
        <FoldedTab
          tab={tab}
          route={route}
          details={registry.details}
          navigation={navigation}
          insets={{ top, ...layout.contentInsets }}
        />
      );
      break;
    case 'split':
      body = (
        <SplitTab
          tab={tab}
          route={route}
          details={registry.details}
          navigation={navigation}
          layout={layout}
          insets={{ top, left: metrics?.safeArea.left ?? 0, right: metrics?.safeArea.right ?? 0 }}
          searchBottom={deriveBottomControlInsets(metrics).bottom + 8}
          expanded={state.tab === props.tabKey && isDetailExpanded(layout, state)}
          onToggleExpanded={props.onToggleExpanded}
        />
      );
      break;
  }
  return (
    <View style={{ flex: 1 }}>
      {body}
      <ActionSlot actions={actions} placement={deriveActionSlotPlacement(metrics)} navigation={navigation} />
    </View>
  );
}
