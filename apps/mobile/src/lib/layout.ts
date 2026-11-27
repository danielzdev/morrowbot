import {
  deriveContentSideInsets,
  safeSpan,
  statusBlockBottom,
  verticalDivisions,
  type NativeLayoutMetrics,
} from './reserved-regions.ts';

export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_WIDTH_FRACTION = 0.36;
export const DETAIL_MIN_WIDTH = 320;
export const SPLIT_MIN_HEIGHT = 400;

/**
 * How the workspace arranges a tab.
 * - `stack`: one column; the list is the root and details push over it (folded, standard iPhone).
 * - `split`: sidebar beside detail (unfolded). When a hinge division is active the columns meet
 *   on it, and the detail cannot expand across it.
 */
export type WorkspaceLayout =
  | {
      readonly kind: 'stack';
      readonly contentInsets: { readonly left: number; readonly right: number };
    }
  | {
      readonly kind: 'split';
      readonly sidebarWidth: number;
      readonly gap: number;
      readonly detailWidth: number;
      readonly hingeAligned: boolean;
      readonly canExpandDetail: boolean;
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function deriveWorkspaceLayout(metrics: NativeLayoutMetrics | null): WorkspaceLayout {
  const stack: WorkspaceLayout = { kind: 'stack', contentInsets: deriveContentSideInsets(metrics) };
  if (!metrics) return stack;
  const room = safeSpan(metrics);
  const usable = room.end - room.start;
  const fitsSplit =
    metrics.horizontalSizeClass === 'regular' &&
    metrics.height >= SPLIT_MIN_HEIGHT &&
    usable >= SIDEBAR_MIN_WIDTH + DETAIL_MIN_WIDTH;
  if (!fitsSplit) return stack;

  const divisions = verticalDivisions(metrics);
  const [hinge] = divisions;
  if (hinge) {
    const sidebarWidth = hinge.start - room.start;
    const detailWidth = room.end - hinge.end;
    const fitsHinge =
      divisions.length === 1 && sidebarWidth >= SIDEBAR_MIN_WIDTH && detailWidth >= DETAIL_MIN_WIDTH;
    if (!fitsHinge) return stack;
    return {
      kind: 'split',
      sidebarWidth,
      gap: hinge.end - hinge.start,
      detailWidth,
      hingeAligned: true,
      canExpandDetail: false,
    };
  }

  const sidebarWidth = clamp(
    Math.round(usable * SIDEBAR_WIDTH_FRACTION),
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );
  return {
    kind: 'split',
    sidebarWidth,
    gap: 0,
    detailWidth: usable - sidebarWidth,
    hingeAligned: false,
    canExpandDetail: true,
  };
}

const ACTION_BUTTON_SIZE = 48;
const ACTION_GAP = 12;
const EDGE_MARGIN = 16;
const BOTTOM_TAB_BAR_HEIGHT = 56;

/**
 * Where the contextual floating actions go.
 * - `vertical-bar`: in the system vertical bar (iPhone Duo), centred across its width, just below
 *   the status block, stacked downwards.
 * - `floating`: a column above the bottom tab bar on the trailing side (standard iPhone).
 */
export type ActionSlotPlacement =
  | {
      readonly kind: 'vertical-bar';
      readonly edge: 'left' | 'right';
      readonly barWidth: number;
      readonly top: number;
    }
  | { readonly kind: 'floating'; readonly right: number; readonly bottom: number };

export function deriveActionSlotPlacement(metrics: NativeLayoutMetrics | null): ActionSlotPlacement {
  if (!metrics) return { kind: 'floating', right: EDGE_MARGIN, bottom: EDGE_MARGIN };
  const edge = metrics.verticalBarEdge;
  switch (edge) {
    case 'left':
    case 'right': {
      const barWidth = edge === 'right' ? metrics.safeArea.right : metrics.safeArea.left;
      if (barWidth < ACTION_BUTTON_SIZE) break;
      return { kind: 'vertical-bar', edge, barWidth, top: statusBlockBottom(metrics, edge) + EDGE_MARGIN };
    }
    case 'none':
      break;
  }
  const tabBarTop = (metrics.bottomBarInset ?? metrics.safeArea.bottom) + BOTTOM_TAB_BAR_HEIGHT;
  return {
    kind: 'floating',
    right: metrics.safeArea.right + EDGE_MARGIN,
    bottom: tabBarTop + ACTION_GAP,
  };
}

export const ACTION_SLOT_METRICS: { readonly buttonSize: number; readonly gap: number } = {
  buttonSize: ACTION_BUTTON_SIZE,
  gap: ACTION_GAP,
};
