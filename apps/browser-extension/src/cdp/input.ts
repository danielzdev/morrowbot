import { z } from 'zod';
import type { ScrollTarget } from '@morrowbot/contracts';
import { BrowserFailure, call, nextEvent, type CdpSession } from './session.ts';

const Quads = z.object({ quads: z.array(z.array(z.number())) });
const Metrics = z.object({
  cssVisualViewport: z.object({ clientWidth: z.number(), clientHeight: z.number(), pageX: z.number(), pageY: z.number() }),
  cssContentSize: z.object({ width: z.number(), height: z.number() }),
});
const DragIntercepted = z.object({ data: z.record(z.string(), z.unknown()) });

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const layoutMetrics = (session: CdpSession): Promise<z.output<typeof Metrics>> => call(session, 'Page.getLayoutMetrics', {}, Metrics);

/** Scrolls the element into view and returns its box in viewport coordinates. */
export async function boxOf(session: CdpSession, backendNodeId: number): Promise<Box> {
  await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  const { quads } = await call(session, 'DOM.getContentQuads', { backendNodeId }, Quads);
  for (const quad of quads) {
    const xs = [quad[0], quad[2], quad[4], quad[6]].filter((value) => value !== undefined);
    const ys = [quad[1], quad[3], quad[5], quad[7]].filter((value) => value !== undefined);
    if (xs.length < 4 || ys.length < 4) continue;
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    if (box.width >= 1 && box.height >= 1) return box;
  }
  throw new BrowserFailure('not-interactable', 'The element has no visible area to act on.');
}

export async function centerOf(session: CdpSession, backendNodeId: number): Promise<Point> {
  const box = await boxOf(session, backendNodeId);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const BUTTON_BITS: Readonly<Record<'left' | 'right' | 'middle', number>> = { left: 1, right: 2, middle: 4 };

export async function click(session: CdpSession, at: Point, button: 'left' | 'right' | 'middle', clickCount: 1 | 2): Promise<void> {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  for (let count = 1; count <= clickCount; count += 1) {
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button, buttons: BUTTON_BITS[button], clickCount: count });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button, buttons: 0, clickCount: count });
  }
}

export async function hover(session: CdpSession, at: Point): Promise<void> {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
}

export async function scroll(session: CdpSession, to: ScrollTarget, nodeOf: (ref: string) => number): Promise<void> {
  switch (to.kind) {
    case 'element':
      await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: nodeOf(to.ref) });
      return;
    case 'page': {
      const { cssVisualViewport: viewport } = await layoutMetrics(session);
      const sign = to.direction === 'up' || to.direction === 'left' ? -1 : 1;
      const vertical = to.direction === 'up' || to.direction === 'down';
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: viewport.clientWidth / 2,
        y: viewport.clientHeight / 2,
        deltaX: vertical ? 0 : sign * to.pixels,
        deltaY: vertical ? sign * to.pixels : 0,
      });
      return;
    }
  }
}

/**
 * Drags with the mouse. When the page starts an HTML drag-and-drop, Chrome hands the drag to us
 * (`Input.setInterceptDrags`) and we drop it on the target ourselves; pointer-based drags just follow the mouse.
 */
export async function drag(session: CdpSession, from: Point, to: Point): Promise<void> {
  await session.send('Input.setInterceptDrags', { enabled: true });
  const intercepted = nextEvent(session, ['Input.dragIntercepted'], (_method, params) => DragIntercepted.parse(params).data, 500);
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    const steps = 5;
    for (let step = 1; step <= steps; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    }
    const data = await intercepted.promise;
    if (data !== null) {
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await session.send('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data });
      }
    }
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  } finally {
    intercepted.cancel();
    await session.send('Input.setInterceptDrags', { enabled: false });
  }
}
