export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export type Side = 'bottom' | 'top' | 'right';
export type Align = 'start' | 'end' | 'center';

export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly side: Side;
}

const GAP = 8;
const GUTTER = 16;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)));

function along(anchorStart: number, anchorSize: number, size: number, align: Align): number {
  switch (align) {
    case 'start':
      return anchorStart;
    case 'end':
      return anchorStart + anchorSize - size;
    case 'center':
      return anchorStart + (anchorSize - size) / 2;
  }
}

/**
 * Where a floating layer goes (spec §1.4): 8px from its anchor on `side`, flipped to the other side
 * when it does not fit there but fits there, and clamped to a 16px window gutter.
 */
export function placeFloating(anchor: Box, size: { readonly width: number; readonly height: number }, viewport: { readonly width: number; readonly height: number }, side: Side, align: Align): Placement {
  const fitsBelow = anchor.top + anchor.height + GAP + size.height <= viewport.height - GUTTER;
  const fitsAbove = anchor.top - GAP - size.height >= GUTTER;
  const fitsRight = anchor.left + anchor.width + GAP + size.width <= viewport.width - GUTTER;
  let chosen = side;
  if (side === 'bottom' && !fitsBelow && fitsAbove) chosen = 'top';
  if (side === 'top' && !fitsAbove && fitsBelow) chosen = 'bottom';
  if (side === 'right' && !fitsRight) chosen = fitsBelow || !fitsAbove ? 'bottom' : 'top';
  const maxTop = viewport.height - GUTTER - size.height;
  const maxLeft = viewport.width - GUTTER - size.width;
  switch (chosen) {
    case 'bottom':
      return { side: chosen, top: clamp(anchor.top + anchor.height + GAP, GUTTER, maxTop), left: clamp(along(anchor.left, anchor.width, size.width, align), GUTTER, maxLeft) };
    case 'top':
      return { side: chosen, top: clamp(anchor.top - GAP - size.height, GUTTER, maxTop), left: clamp(along(anchor.left, anchor.width, size.width, align), GUTTER, maxLeft) };
    case 'right':
      return { side: chosen, top: clamp(along(anchor.top, anchor.height, size.height, align), GUTTER, maxTop), left: clamp(anchor.left + anchor.width + GAP, GUTTER, maxLeft) };
  }
}
