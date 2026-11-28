import type { AxElement, DesktopState, HelperTarget, Point, Rect, WindowInfo, WindowState } from './protocol.ts';

/**
 * How a snapshot's coordinates map to global screen points: `global = origin + local × scale`.
 * Local coordinates run from 0 up to (not including) `width` × `height`: screenshot pixels when the
 * snapshot has an image, otherwise points from the window's top-left corner.
 */
export interface Space {
  readonly originX: number;
  readonly originY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly width: number;
  readonly height: number;
}

export function spaceOf(frame: Rect, image: { readonly width: number; readonly height: number } | null): Space {
  if (image === null) return { originX: frame.x, originY: frame.y, scaleX: 1, scaleY: 1, width: frame.width, height: frame.height };
  return { originX: frame.x, originY: frame.y, scaleX: frame.width / image.width, scaleY: frame.height / image.height, width: image.width, height: image.height };
}

export function toGlobal(space: Space, local: Point): Point {
  return { x: space.originX + local.x * space.scaleX, y: space.originY + local.y * space.scaleY };
}

/** A global rectangle in the snapshot's local coordinates, rounded to whole units. */
export function toLocal(space: Space, rect: Rect): Rect {
  return {
    x: Math.round((rect.x - space.originX) / space.scaleX),
    y: Math.round((rect.y - space.originY) / space.scaleY),
    width: Math.round(rect.width / space.scaleX),
    height: Math.round(rect.height / space.scaleY),
  };
}

export interface ElementEntry {
  readonly ref: string;
  readonly element: AxElement;
}

export interface WindowSnapshot {
  readonly kind: 'window';
  readonly id: string;
  readonly window: WindowInfo;
  readonly space: Space;
  readonly elements: readonly ElementEntry[];
}

export interface DesktopSnapshot {
  readonly kind: 'desktop';
  readonly id: string;
  readonly displayId: number;
  readonly frame: Rect;
  readonly space: Space;
}

export type Snapshot = WindowSnapshot | DesktopSnapshot;

/** Where an agent wants an action to land. */
export type TargetInput = { readonly ref: string } | { readonly snapshot: string; readonly x: number; readonly y: number };

export type Resolved = { readonly kind: 'target'; readonly target: HelperTarget } | { readonly kind: 'refused'; readonly reason: string };

const KEEP = 8;
const REF = /^(s\d+)\/(e\d+)$/;

/**
 * The snapshots an agent may still act on. A new snapshot of a window or display replaces the one
 * before it, and only the last few are kept, so a ref or point from an older one is refused.
 */
export class Snapshots {
  private next = 1;
  private readonly live: Snapshot[] = [];
  private readonly replaced = new Set<string>();

  addWindow(state: WindowState): WindowSnapshot {
    const id = this.newId();
    const elements = state.elements.map((element, index) => ({ ref: `${id}/e${String(index + 1)}`, element }));
    const snapshot: WindowSnapshot = { kind: 'window', id, window: state.window, space: spaceOf(state.window.frame, state.image), elements };
    this.keep(snapshot, (old) => old.kind === 'window' && old.window.windowId === state.window.windowId);
    return snapshot;
  }

  addDesktop(state: DesktopState): DesktopSnapshot {
    const id = this.newId();
    const snapshot: DesktopSnapshot = { kind: 'desktop', id, displayId: state.display.displayId, frame: state.display.frame, space: spaceOf(state.display.frame, state.image) };
    this.keep(snapshot, (old) => old.kind === 'desktop' && old.displayId === state.display.displayId);
    return snapshot;
  }

  /** The global point and the check the helper runs before acting, or why the target is refused. */
  resolve(input: TargetInput): Resolved {
    if ('ref' in input) return this.resolveRef(input.ref);
    const found = this.find(input.snapshot);
    if (found.kind === 'refused') return found;
    const { snapshot } = found;
    const { space } = snapshot;
    if (!(input.x >= 0 && input.x < space.width && input.y >= 0 && input.y < space.height)) {
      return refused(`(${String(input.x)}, ${String(input.y)}) is outside snapshot ${snapshot.id}, whose coordinates run x 0–${String(space.width - 1)}, y 0–${String(space.height - 1)}.`);
    }
    const point = toGlobal(space, input);
    switch (snapshot.kind) {
      case 'window':
        return { kind: 'target', target: { point, check: { kind: 'window', windowId: snapshot.window.windowId, windowFrame: snapshot.window.frame } } };
      case 'desktop':
        return { kind: 'target', target: { point, check: { kind: 'display', displayId: snapshot.displayId, frame: snapshot.frame } } };
    }
  }

  private resolveRef(ref: string): Resolved {
    const match = REF.exec(ref);
    if (match?.[1] === undefined) return refused(`"${ref}" is not an element ref; refs look like s3/e12.`);
    const found = this.find(match[1]);
    if (found.kind === 'refused') return found;
    const { snapshot } = found;
    if (snapshot.kind !== 'window') return refused(`${snapshot.id} is a desktop snapshot, which has no element refs. Click by point instead.`);
    const entry = snapshot.elements.find((candidate) => candidate.ref === ref);
    if (entry === undefined) return refused(`Snapshot ${snapshot.id} has no element ${ref}.`);
    const { frame } = entry.element;
    if (frame === null || frame.width <= 0 || frame.height <= 0) return refused(`${ref} (${entry.element.role}) has no size on screen, so it cannot be targeted.`);
    const point = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    const { windowId, frame: windowFrame } = snapshot.window;
    return { kind: 'target', target: { point, check: { kind: 'element', windowId, windowFrame, path: entry.element.path, role: entry.element.role, frame } } };
  }

  private find(id: string): { readonly kind: 'found'; readonly snapshot: Snapshot } | { readonly kind: 'refused'; readonly reason: string } {
    const snapshot = this.live.find((candidate) => candidate.id === id);
    if (snapshot !== undefined) return { kind: 'found', snapshot };
    if (this.replaced.has(id)) return refused(`Snapshot ${id} is stale: a newer snapshot replaced it. Use the refs and coordinates from the latest get_window_state or get_desktop_state.`);
    return refused(`There is no snapshot ${id}. Call get_window_state or get_desktop_state first.`);
  }

  private newId(): string {
    const id = `s${String(this.next)}`;
    this.next += 1;
    return id;
  }

  private keep(snapshot: Snapshot, replaces: (old: Snapshot) => boolean): void {
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const old = this.live[index];
      if (old !== undefined && replaces(old)) this.retire(index);
    }
    this.live.push(snapshot);
    while (this.live.length > KEEP) this.retire(0);
  }

  private retire(index: number): void {
    const [old] = this.live.splice(index, 1);
    if (old !== undefined) this.replaced.add(old.id);
  }
}

function refused(reason: string): { readonly kind: 'refused'; readonly reason: string } {
  return { kind: 'refused', reason };
}
