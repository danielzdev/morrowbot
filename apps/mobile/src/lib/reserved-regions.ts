import { z } from 'zod';

const Finite = z.number().refine(Number.isFinite);
const Size = Finite.refine((value) => value >= 0);

const ReservedRegion = z.object({
  kind: z.enum(['division', 'occlusion']),
  x: Finite,
  y: Finite,
  width: Size,
  height: Size,
});
export type ReservedRegion = z.infer<typeof ReservedRegion>;

const Insets = z.object({ top: Size, bottom: Size, left: Size, right: Size });
export type Insets = z.infer<typeof Insets>;

const NativeLayoutMetrics = z.object({
  width: Size,
  height: Size,
  hasHinge: z.boolean(),
  horizontalSizeClass: z.enum(['compact', 'regular']),
  verticalBarEdge: z.enum(['none', 'left', 'right']),
  safeArea: Insets,
  reservedRegions: z.array(ReservedRegion),
  bottomBarInset: Size.nullish().transform((value) => value ?? null),
});
/** Geometry reported by `MorrowLayoutMetricsView`, in points of the observing view. */
export type NativeLayoutMetrics = z.infer<typeof NativeLayoutMetrics>;

/** Parses the native `onMetricsChange` payload. Returns null for anything malformed. */
export function parseNativeLayoutMetrics(payload: unknown): NativeLayoutMetrics | null {
  const parsed = NativeLayoutMetrics.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** A horizontal span `[start, end)` in points. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The horizontal room left between the safe-area edges. */
export function safeSpan(metrics: NativeLayoutMetrics): Span {
  return { start: metrics.safeArea.left, end: metrics.width - metrics.safeArea.right };
}

/** A division that cuts the window into two sides, such as a vertical hinge. */
export function isFullHeightDivision(region: ReservedRegion, metrics: NativeLayoutMetrics): boolean {
  return region.kind === 'division' && region.height >= metrics.height / 2;
}

/** The vertical divisions crossing the safe span, left to right, clipped to it. */
export function verticalDivisions(metrics: NativeLayoutMetrics): readonly Span[] {
  const room = safeSpan(metrics);
  return metrics.reservedRegions
    .filter((region) => isFullHeightDivision(region, metrics))
    .map((region) => ({
      start: Math.max(room.start, region.x),
      end: Math.min(room.end, region.x + region.width),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
}

/** Keeps the wider side of `span` once `cut` is removed from it. Ties keep the leading side. */
function widerSide(span: Span, cut: Span): Span {
  const leading = { start: span.start, end: Math.max(span.start, Math.min(span.end, cut.start)) };
  const trailing = { start: Math.min(span.end, Math.max(span.start, cut.end)), end: span.end };
  return trailing.end - trailing.start > leading.end - leading.start ? trailing : leading;
}

function width(span: Span): number {
  return span.end - span.start;
}

/**
 * Left and right insets that keep one column of content inside the safe area and on one side
 * of every vertical division, so nothing straddles the hinge.
 */
export function deriveContentSideInsets(metrics: NativeLayoutMetrics | null): {
  readonly left: number;
  readonly right: number;
} {
  if (!metrics) return { left: 0, right: 0 };
  const room = verticalDivisions(metrics).reduce(widerSide, safeSpan(metrics));
  return { left: room.start, right: metrics.width - room.end };
}

/**
 * Where bottom-anchored controls (a composer, a search pill) can sit: inside the side insets,
 * and above or beside any region that occludes the bottom edge.
 */
export function deriveBottomControlInsets(metrics: NativeLayoutMetrics | null): {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
} {
  if (!metrics) return { left: 0, right: 0, bottom: 0 };
  const sides = deriveContentSideInsets(metrics);
  let room: Span = { start: sides.left, end: metrics.width - sides.right };
  let bottomEdge = metrics.height - metrics.safeArea.bottom;
  const occlusions = metrics.reservedRegions
    .filter((region) => region.kind === 'occlusion')
    .filter((region) => region.y + region.height >= bottomEdge && region.y < metrics.height);
  for (const region of occlusions) {
    const cut = { start: region.x, end: region.x + region.width };
    if (Math.min(room.end, cut.end) <= Math.max(room.start, cut.start)) continue;
    const beside = widerSide(room, cut);
    if (width(beside) >= width(room) / 2) {
      room = beside;
    } else {
      bottomEdge = Math.min(bottomEdge, region.y);
    }
  }
  return {
    left: room.start,
    right: metrics.width - room.end,
    bottom: Math.max(metrics.safeArea.bottom, metrics.height - bottomEdge),
  };
}

/** The bottom of the system status block when it sits at the top of the given edge. */
export function statusBlockBottom(metrics: NativeLayoutMetrics, edge: 'left' | 'right'): number {
  const band = edge === 'right'
    ? { start: metrics.width - metrics.safeArea.right, end: metrics.width }
    : { start: 0, end: metrics.safeArea.left };
  return metrics.reservedRegions
    .filter((region) => region.kind === 'occlusion' && region.y <= 0)
    .filter((region) => Math.min(band.end, region.x + region.width) > Math.max(band.start, region.x))
    .reduce((bottom, region) => Math.max(bottom, region.y + region.height), metrics.safeArea.top);
}
