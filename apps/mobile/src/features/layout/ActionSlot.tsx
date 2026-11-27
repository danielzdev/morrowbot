import { StyleSheet, View } from 'react-native';
import { GlassButton } from '../../lib/GlassButton.tsx';
import { ACTION_SLOT_METRICS, type ActionSlotPlacement } from '../../lib/layout.ts';
import type { SlotAction, WorkspaceNavigation } from '../../lib/workspace.ts';

/** The contextual floating Liquid Glass buttons, in the vertical bar or above the tab bar. */
export function ActionSlot(props: {
  readonly actions: readonly SlotAction[];
  readonly placement: ActionSlotPlacement;
  readonly navigation: WorkspaceNavigation;
}) {
  if (props.actions.length === 0) return null;
  const { buttonSize, gap } = ACTION_SLOT_METRICS;
  const { placement } = props;
  let position;
  switch (placement.kind) {
    case 'vertical-bar':
      position = {
        top: placement.top,
        width: placement.barWidth,
        [placement.edge]: 0,
      };
      break;
    case 'floating':
      position = { right: placement.right, bottom: placement.bottom, width: buttonSize };
      break;
  }
  return (
    <View pointerEvents="box-none" style={[styles.column, { gap }, position]}>
      {props.actions.map((action) => (
        <GlassButton
          key={action.id}
          symbol={action.symbol}
          label={action.label}
          size={buttonSize}
          onPress={() => {
            action.onPress(props.navigation);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { position: 'absolute', alignItems: 'center' },
});
