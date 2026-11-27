import type { NativeLayoutMetrics } from './reserved-regions.ts';

/**
 * Illustrative geometry in points, shaped like what `MorrowLayoutMetricsView` reports.
 * Sizes are rounded from simulator captures; they are examples, not device specs.
 */

/** A standard iPhone in portrait: no hinge, no vertical bar, tab bar at the bottom. */
export const standardIPhone: NativeLayoutMetrics = {
  width: 402,
  height: 874,
  hasHinge: false,
  horizontalSizeClass: 'compact',
  verticalBarEdge: 'none',
  safeArea: { top: 62, bottom: 34, left: 0, right: 0 },
  reservedRegions: [],
  bottomBarInset: null,
};

/** iPhone Duo folded (cover screen): system bar on the right with the status block at its top. */
export const foldedDuo: NativeLayoutMetrics = {
  width: 466,
  height: 678,
  hasHinge: true,
  horizontalSizeClass: 'compact',
  verticalBarEdge: 'right',
  safeArea: { top: 0, bottom: 20, left: 0, right: 76 },
  reservedRegions: [{ kind: 'occlusion', x: 390, y: 0, width: 76, height: 240 }],
  bottomBarInset: 20,
};

/** iPhone Duo unfolded flat: wide, right system bar, a hinge but no active division. */
export const unfoldedDuo: NativeLayoutMetrics = {
  width: 951,
  height: 669,
  hasHinge: true,
  horizontalSizeClass: 'regular',
  verticalBarEdge: 'right',
  safeArea: { top: 0, bottom: 20, left: 0, right: 70 },
  reservedRegions: [{ kind: 'occlusion', x: 881, y: 0, width: 70, height: 230 }],
  bottomBarInset: 20,
};

/** iPhone Duo unfolded in book posture: the hinge is an active full-height division. */
export const unfoldedDuoWithHinge: NativeLayoutMetrics = {
  ...unfoldedDuo,
  reservedRegions: [
    ...unfoldedDuo.reservedRegions,
    { kind: 'division', x: 436, y: 0, width: 10, height: 669 },
  ],
};
