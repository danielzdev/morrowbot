import { View } from 'react-native';
import { Stack } from 'react-native-screens';
import { useTheme } from '../../lib/useTheme.ts';
import type { DetailRegistry, DetailRoute, TabSlot, WorkspaceNavigation } from '../../lib/workspace.ts';
import { DetailPane } from './DetailPane.tsx';

export interface ContentInsets {
  readonly top: number;
  readonly left: number;
  readonly right: number;
}

/** Folded: the list is the root screen and the detail is pushed over it. */
export function FoldedTab(props: {
  readonly tab: TabSlot;
  readonly route: DetailRoute | null;
  readonly details: DetailRegistry;
  readonly navigation: WorkspaceNavigation;
  readonly insets: ContentInsets;
}) {
  const theme = useTheme();
  const { Sidebar } = props.tab;
  const frame = {
    flex: 1,
    paddingTop: props.insets.top,
    paddingLeft: props.insets.left,
    paddingRight: props.insets.right,
    backgroundColor: theme.colors.surface0,
  };
  return (
    <Stack.Host colorScheme={theme.scheme}>
      <Stack.Screen screenKey="list" activityMode="attached">
        <View style={frame}>
          <Sidebar selected={props.route} navigation={props.navigation} />
        </View>
      </Stack.Screen>
      {props.route ? (
        <Stack.Screen screenKey="detail" activityMode="attached" onNativeDismiss={props.navigation.closeDetail}>
          <View style={frame}>
            <DetailPane
              route={props.route}
              details={props.details}
              navigation={props.navigation}
              leading={{ kind: 'back' }}
            />
          </View>
        </Stack.Screen>
      ) : null}
    </Stack.Host>
  );
}
