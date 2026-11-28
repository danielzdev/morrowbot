import { useMemo, useReducer, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'react-native-screens';
import { MorrowLayoutMetricsView } from '../../../modules/morrow-native-controls/index.ts';
import { parseNativeLayoutMetrics, type NativeLayoutMetrics } from '../../lib/reserved-regions.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { detailSlotFor, type TabKey, type WorkspaceNavigation, type WorkspaceRegistry } from '../../lib/workspace.ts';
import { TabContent } from './TabContent.tsx';
import { TAB_ITEMS, tabKeyOf } from './tabs.ts';
import { initialWorkspaceState, workspaceReducer } from './workspace-state.ts';

/**
 * The adaptive iPhone Duo shell: the native tab rail (UIKit moves it into the vertical bar on
 * iPhone Duo), each tab folded into a push stack or unfolded into a hinge-safe split.
 */
export function WorkspaceShell(props: { readonly registry: WorkspaceRegistry }) {
  const { registry } = props;
  const theme = useTheme();
  const [metrics, setMetrics] = useState<NativeLayoutMetrics | null>(null);
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [provenance, setProvenance] = useState(0);
  const [onScreen, setOnScreen] = useState<TabKey | null>(null);

  const navigation = useMemo<WorkspaceNavigation>(
    () => ({
      open: (route) => {
        dispatch({ kind: 'open', route, tabs: detailSlotFor(registry.details, route).tabs });
      },
      closeDetail: () => {
        dispatch({ kind: 'close-detail' });
      },
    }),
    [registry],
  );
  const toggleExpanded = () => {
    dispatch({ kind: 'toggle-expanded' });
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.surface0 }]}>
      <MorrowLayoutMetricsView
        style={StyleSheet.absoluteFill}
        onMetricsChange={(event) => {
          const next = parseNativeLayoutMetrics(event.nativeEvent);
          if (next) setMetrics(next);
        }}
      />
      <Tabs.Host
        navStateRequest={{ selectedScreenKey: state.tab, baseProvenance: provenance }}
        colorScheme={theme.scheme}
        onTabSelected={({ nativeEvent }) => {
          setProvenance(nativeEvent.provenance);
          const tab = tabKeyOf(nativeEvent.selectedScreenKey);
          if (tab) dispatch({ kind: 'select-tab', tab });
        }}
      >
        {TAB_ITEMS.map((item) => (
          <Tabs.Screen
            key={item.key}
            screenKey={item.key}
            title={item.title}
            ios={{ icon: { type: 'sfSymbol', name: item.symbol } }}
            onDidAppear={() => {
              setOnScreen(item.key);
            }}
            onDidDisappear={() => {
              setOnScreen((current) => (current === item.key ? null : current));
            }}
          >
            <TabContent
              tabKey={item.key}
              onScreen={onScreen === item.key}
              state={state}
              metrics={metrics}
              registry={registry}
              navigation={navigation}
              onToggleExpanded={toggleExpanded}
            />
          </Tabs.Screen>
        ))}
      </Tabs.Host>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
