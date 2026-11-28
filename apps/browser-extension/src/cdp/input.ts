import { z } from 'zod';
import type { ScrollTarget } from '@morrowbot/contracts';
import { BrowserFailure, call, type CdpSession } from './session.ts';

const Quads = z.object({ quads: z.array(z.array(z.number())) });
const Metrics = z.object({
  cssVisualViewport: z.object({ clientWidth: z.number(), clientHeight: z.number(), pageX: z.number(), pageY: z.number() }),
  cssContentSize: z.object({ width: z.number(), height: z.number() }),
});
const WheelOutcome = z.object({
  result: z.object({ value: z.enum(['scrolled', 'wheel-only', 'no-wheel']).optional() }),
});
const DragData = z.looseObject({
  items: z.array(
    z.looseObject({
      mimeType: z.string(),
      data: z.string(),
      title: z.string().optional(),
      baseURL: z.string().optional(),
    }),
  ),
  files: z.array(z.string()).optional(),
  dragOperationsMask: z.number().optional(),
});
const DragIntercepted = z.looseObject({ data: DragData });

const WHEEL_WAIT_KEY = '__morrowbotScrollWait';

const ARM_WHEEL_WAIT = `(() => {
  const key = '${WHEEL_WAIT_KEY}';
  if (typeof window[key]?.cancel === 'function') window[key].cancel();
  let sawWheel = false;
  let sawScroll = false;
  let settleTimer = 0;
  let done = false;
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  const finish = (status) => {
    if (done) return;
    done = true;
    clearTimeout(settleTimer);
    clearTimeout(hardTimer);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('scrollend', onScrollEnd, true);
    resolvePromise(status);
  };
  const schedule = (ms, status) => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => finish(status), ms);
  };
  const onWheel = () => {
    sawWheel = true;
    if (sawScroll) return;
    if (document.visibilityState === 'visible') {
      schedule(1000, 'wheel-only');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!sawScroll) schedule(150, 'wheel-only');
        });
      });
    } else {
      schedule(250, 'wheel-only');
    }
  };
  const onScroll = () => {
    sawScroll = true;
    schedule('onscrollend' in window ? 800 : 200, 'scrolled');
  };
  const onScrollEnd = () => {
    finish('scrolled');
  };
  window.addEventListener('wheel', onWheel, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('scrollend', onScrollEnd, true);
  schedule(600, 'no-wheel');
  const hardTimer = setTimeout(() => finish(sawScroll ? 'scrolled' : sawWheel ? 'wheel-only' : 'no-wheel'), 3000);
  window[key] = { promise, cancel: () => finish('no-wheel') };
})()`;

const AWAIT_WHEEL_WAIT = `(() => {
  const key = '${WHEEL_WAIT_KEY}';
  const entry = window[key];
  if (!entry) return 'no-wheel';
  return entry.promise.finally(() => {
    if (window[key] === entry) delete window[key];
  });
})()`;

const CANCEL_WHEEL_WAIT = `(() => {
  const key = '${WHEEL_WAIT_KEY}';
  const entry = window[key];
  if (!entry) return;
  entry.cancel();
  if (window[key] === entry) delete window[key];
})()`;

const WAIT_FOR_FRAME = `new Promise((resolve) => {
  if (document.visibilityState !== 'visible') {
    setTimeout(resolve, 50);
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve(undefined);
  };
  const timer = setTimeout(finish, 250);
  requestAnimationFrame(() => requestAnimationFrame(finish));
})`;

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
      const x = viewport.clientWidth / 2;
      const y = viewport.clientHeight / 2;
      const deltaX = vertical ? 0 : sign * to.pixels;
      const deltaY = vertical ? sign * to.pixels : 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const outcome = await dispatchWheelAndSettle(session, x, y, deltaX, deltaY);
        if (outcome !== 'no-wheel') return;
      }
      return;
    }
  }
}

async function dispatchWheelAndSettle(session: CdpSession, x: number, y: number, deltaX: number, deltaY: number): Promise<'scrolled' | 'wheel-only' | 'no-wheel'> {
  await session.send('Runtime.evaluate', { expression: ARM_WHEEL_WAIT });
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
  } catch (error) {
    await session.send('Runtime.evaluate', { expression: CANCEL_WHEEL_WAIT }).catch(() => undefined);
    throw error;
  }
  const { result } = await call(session, 'Runtime.evaluate', { expression: AWAIT_WHEEL_WAIT, returnByValue: true, awaitPromise: true }, WheelOutcome);
  return result.value ?? 'no-wheel';
}

async function waitForFrame(session: CdpSession): Promise<void> {
  await session.send('Runtime.evaluate', { expression: WAIT_FOR_FRAME, awaitPromise: true });
}

/** Drags with the mouse: intercepts HTML5 drags via CDP so off-screen scrolls and headless Linux cannot drop them, and falls back to pointer moves otherwise. */
export async function drag(session: CdpSession, source: () => Promise<Point>, target: () => Promise<Point>): Promise<void> {
  const move = (point: Point): Promise<unknown> => session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
  const dragState: { data: z.output<typeof DragData> | null } = { data: null };
  const intercepted = Promise.withResolvers<z.output<typeof DragData>>();
  const stopListening = session.on('Input.dragIntercepted', (params) => {
    const parsed = DragIntercepted.safeParse(params);
    if (parsed.success) {
      dragState.data = parsed.data.data;
      intercepted.resolve(parsed.data.data);
    }
  });
  let interceptEnabled = false;
  try {
    try {
      await session.send('Input.setInterceptDrags', { enabled: true });
      interceptEnabled = true;
    } catch {
      interceptEnabled = false;
    }
    await source();
    await waitForFrame(session);
    const from = await source();
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 4; step += 1) {
      await move({ x: from.x + step * 4, y: from.y + step * 4 });
      if (dragState.data !== null) break;
    }
    if (interceptEnabled && dragState.data === null) await Promise.race([intercepted.promise, waitForFrame(session)]);
    await target();
    await waitForFrame(session);
    const to = await target();
    if (dragState.data !== null) {
      const data = { ...dragState.data, dragOperationsMask: dragState.data.dragOperationsMask ?? 1 };
      await session.send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data });
      await session.send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data });
      await session.send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    } else {
      const steps = 5;
      for (let step = 1; step <= steps; step += 1) await move({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
      await move(to);
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await waitForFrame(session);
  } finally {
    stopListening();
    if (interceptEnabled) await session.send('Input.setInterceptDrags', { enabled: false }).catch(() => undefined);
  }
}
