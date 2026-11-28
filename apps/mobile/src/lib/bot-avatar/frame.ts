import type { AgentAvatar } from '@morrowbot/contracts';
import { avatarFrame, type AvatarDefinition, type AvatarFrame, type AvatarMotionBlend, type AvatarStateDefinition, type AvatarState, type AvatarMood } from 'open-bot-avatar';

/** Closest on-screen spacing, in points, between the cross-sections drawn: the engine's own live renderers keep 0.75 px. */
const SLICE_GAP_PT = 0.75;

const quantize = (step: number) => (n: number): number => Math.round(n / step);
const hundredths = (n: number): number => Math.round(n * 100);

/**
 * The frame with only the cross-sections that show at `size` points: of the slices that would land within
 * SLICE_GAP_PT of each other (an outline about the same centre, in about the same place), only the frontmost is drawn. Each slice is one
 * native view, so a 28 pt row draws a handful instead of a hundred, and looks the same.
 */
export function thinned(frame: AvatarFrame, size: number): AvatarFrame {
  const near = quantize((SLICE_GAP_PT * 100) / size);
  const boxes = new Map(frame.paths.map(({ id, box }) => [id, box]));
  const frontmost = new Map<string, number>();
  frame.shapes.forEach((shape, index) => {
    if (shape.kind !== 'slice') return;
    const box = boxes.get(shape.path);
    const [a, b, c, d, e, f] = shape.matrix;
    const key = box === undefined ? `${shape.path}#${String(index)}` : [box.x + box.w / 2, box.y + box.h / 2, e, f].map(near).concat([a, b, c, d].map(hundredths)).join(' ');
    frontmost.set(key, index);
  });
  const kept = new Set(frontmost.values());
  const shapes = frame.shapes.filter((shape, index) => shape.kind !== 'slice' || kept.has(index));
  const used = new Set(shapes.flatMap((shape) => (shape.kind === 'slice' ? [shape.path] : [])));
  return { ...frame, shapes, paths: frame.paths.filter(({ id }) => used.has(id)) };
}

/** What a frame shows: a pose of the agent's avatar, and for a live one where its clock and easing are. */
export interface FramePose {
  readonly state: AvatarState | AvatarStateDefinition;
  readonly mood: AvatarMood;
  /** Seconds on the animation clock; a still frame passes 0. */
  readonly time: number;
  readonly stateAge: number;
  readonly motionBlend: AvatarMotionBlend | undefined;
  readonly gaze: { readonly x: number; readonly y: number; readonly weight: number } | undefined;
  readonly still: boolean;
}

/** A still, calm pose of `state`: the avatar in a list row, or a moving one under Reduce Motion. */
export const stillPose = (state: AvatarState | AvatarStateDefinition, mood: AvatarMood): FramePose => ({
  state,
  mood,
  time: 0,
  stateAge: 0,
  motionBlend: undefined,
  gaze: undefined,
  still: true,
});

export function frameOf(definition: AvatarDefinition, avatar: AgentAvatar, pose: FramePose, size: number): AvatarFrame {
  const frame = avatarFrame(definition, {
    color: avatar.color,
    state: pose.state,
    mood: pose.mood,
    time: pose.time,
    stateAge: pose.stateAge,
    ...(pose.motionBlend === undefined ? {} : { motionBlend: pose.motionBlend }),
    ...(pose.gaze === undefined ? {} : { gaze: pose.gaze }),
    reducedMotion: pose.still,
  });
  return thinned(frame, size);
}

/** The box the body's cross-sections cover, in the coordinates they are drawn in: where a finish's light spans. */
export function bodyBox(frame: AvatarFrame): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
  const boxes = new Map(frame.paths.map(({ id, box }) => [id, box]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const shape of frame.shapes) {
    const box = shape.kind === 'slice' ? boxes.get(shape.path) : undefined;
    if (shape.kind !== 'slice' || box === undefined) continue;
    const [a, b, c, d, e, f] = shape.matrix;
    const corners: readonly (readonly [number, number])[] = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
    for (const [x, y] of corners) {
      const px = a * x + c * y + e, py = b * x + d * y + f;
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
  }
  return x0 > x1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
