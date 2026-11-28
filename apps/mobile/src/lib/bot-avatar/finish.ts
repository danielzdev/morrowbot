import type { AvatarFinish } from '@morrowbot/contracts';

export interface Stop {
  readonly offset: number;
  readonly color: '#ffffff' | '#000000';
  readonly opacity: number;
}

/** A light painted over each cross-section, placed in shares (0–1) of the whole body's box. */
export type Sheen =
  | { readonly kind: 'radial'; readonly id: string; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: readonly Stop[] }
  | { readonly kind: 'linear'; readonly id: string; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly stops: readonly Stop[] };

/**
 * How a finish paints on the phone. Desktop lights matte and metallic with SVG lighting filters and grows fur
 * with WebGL; neither exists in react-native-svg, so the light comes from the top left as gradients over the
 * flat body, and fur is a ring of soft tufts along the front outline.
 */
export interface FinishLook {
  readonly sheens: readonly Sheen[];
  readonly fur: boolean;
}

const white = (offset: number, opacity: number): Stop => ({ offset, color: '#ffffff', opacity });
const black = (offset: number, opacity: number): Stop => ({ offset, color: '#000000', opacity });

const MATTE: Sheen = { kind: 'radial', id: 'matte', cx: 0.34, cy: 0.28, r: 0.85, stops: [white(0, 0.3), white(0.45, 0), black(1, 0.28)] };
const METAL: Sheen = {
  kind: 'linear',
  id: 'metal',
  x1: 0,
  y1: 0,
  x2: 0.55,
  y2: 1,
  stops: [white(0, 0.6), white(0.26, 0.08), black(0.42, 0.3), white(0.6, 0.38), black(0.82, 0.12), black(1, 0.4)],
};
const SHINE: Sheen = { kind: 'radial', id: 'shine', cx: 0.3, cy: 0.22, r: 0.22, stops: [white(0, 0.75), white(1, 0)] };
const FUR: Sheen = { kind: 'radial', id: 'fur', cx: 0.4, cy: 0.32, r: 0.9, stops: [white(0, 0.16), white(0.55, 0), black(1, 0.18)] };

export function finishLook(finish: AvatarFinish): FinishLook {
  switch (finish) {
    case 'flat':
      return { sheens: [], fur: false };
    case 'matte':
      return { sheens: [MATTE], fur: false };
    case 'metallic':
      return { sheens: [METAL, SHINE], fur: false };
    case 'fluffy':
      return { sheens: [FUR], fur: true };
  }
}

/** Fur tufts along an outline, in viewBox units: round dots almost touching, thicker than the edge they sit on. */
export const FUR_STROKE: { readonly width: number; readonly dash: string } = { width: 3.2, dash: '0.01 2.3' };
