import { StyleSheet, View } from 'react-native';
import { GlassButton } from '../../lib/GlassButton.tsx';
import { spacing } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import {
  detailSlotFor,
  type DetailRegistry,
  type DetailRoute,
  type DetailRouteKind,
  type WorkspaceNavigation,
} from '../../lib/workspace.ts';

const HEADER_BUTTON = 40;

/**
 * What sits at the start of the detail header.
 * - `back`: folded, the detail was pushed over the list.
 * - `expand`: unfolded, the `⤢` toggle that hides or shows the sidebar.
 * - `none`: unfolded on a hinge, where the detail cannot grow across the fold.
 */
export type DetailLeading =
  | { readonly kind: 'back' }
  | { readonly kind: 'expand'; readonly expanded: boolean; readonly onToggle: () => void }
  | { readonly kind: 'none' };

/** Hosts any detail route: the shell draws the header chrome, the route's slot fills it. */
export function DetailPane<K extends DetailRouteKind>(props: {
  readonly route: DetailRoute<K>;
  readonly details: DetailRegistry;
  readonly navigation: WorkspaceNavigation;
  readonly leading: DetailLeading;
}) {
  const theme = useTheme();
  const slot = detailSlotFor(props.details, props.route);
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.surface0 }]}>
      <View style={styles.header}>
        <Leading leading={props.leading} navigation={props.navigation} />
        <View style={styles.title}>
          <slot.Title route={props.route} />
        </View>
      </View>
      <View style={styles.fill}>
        <slot.Body route={props.route} navigation={props.navigation} />
      </View>
    </View>
  );
}

function Leading(props: { readonly leading: DetailLeading; readonly navigation: WorkspaceNavigation }) {
  const { leading } = props;
  switch (leading.kind) {
    case 'back':
      return (
        <GlassButton symbol="chevron.left" label="Back" size={HEADER_BUTTON} onPress={props.navigation.closeDetail} />
      );
    case 'expand':
      return (
        <GlassButton
          symbol={leading.expanded ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'}
          label={leading.expanded ? 'Show sidebar' : 'Expand to full screen'}
          size={HEADER_BUTTON}
          onPress={leading.onToggle}
        />
      );
    case 'none':
      return null;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  title: { flex: 1 },
});
