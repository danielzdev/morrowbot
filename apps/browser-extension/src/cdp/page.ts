import { z } from 'zod';
import { BrowserDialog, type NavigateTarget, type ScreenshotArea } from '@morrowbot/contracts';
import { boxOf, layoutMetrics } from './input.ts';
import { BrowserFailure, call, nextEvent, type CdpSession } from './session.ts';

const LOAD_WAIT_MS = 20_000;
const MAX_CAPTURE_PX = 16_384;

const Navigated = z.object({ loaderId: z.string().optional(), errorText: z.string().optional() });
const History = z.object({ currentIndex: z.number().int(), entries: z.array(z.object({ id: z.number().int() })) });
const Captured = z.object({ data: z.string() });
const FrameNavigated = z.object({ frame: z.object({ parentId: z.string().optional() }), type: z.string().optional() });
const DialogOpening = z.object({ message: z.string(), type: BrowserDialog.shape.type, defaultPrompt: z.string().optional() });

/** Navigates and waits for the page to load (or a dialog to open). False when it was still loading at the time limit. */
export async function navigate(session: CdpSession, to: NavigateTarget): Promise<boolean> {
  const loaded = nextEvent(
    session,
    ['Page.loadEventFired', 'Page.frameNavigated', 'Page.javascriptDialogOpening'],
    (method, params) => {
      if (method !== 'Page.frameNavigated') return true;
      const { frame, type } = FrameNavigated.parse(params);
      return frame.parentId === undefined && type === 'BackForwardCacheRestore' ? true : null;
    },
    LOAD_WAIT_MS,
  );
  try {
    const sameDocument = await start(session, to);
    if (sameDocument) return true;
    return (await loaded.promise) ?? false;
  } finally {
    loaded.cancel();
  }
}

/** Starts the navigation; true when it stayed in the same document (no load to wait for). */
async function start(session: CdpSession, to: NavigateTarget): Promise<boolean> {
  switch (to.kind) {
    case 'url': {
      const { loaderId, errorText } = await call(session, 'Page.navigate', { url: to.url }, Navigated);
      if (errorText !== undefined && errorText !== '') throw new BrowserFailure('failed', `Could not open ${to.url}: ${errorText}`);
      return loaderId === undefined;
    }
    case 'back':
    case 'forward': {
      const { currentIndex, entries } = await call(session, 'Page.getNavigationHistory', {}, History);
      const entry = entries[currentIndex + (to.kind === 'back' ? -1 : 1)];
      if (entry === undefined) throw new BrowserFailure('failed', `There is no page to go ${to.kind} to.`);
      await session.send('Page.navigateToHistoryEntry', { entryId: entry.id });
      return false;
    }
    case 'reload':
      await session.send('Page.reload', {});
      return false;
  }
}

export async function screenshot(session: CdpSession, area: ScreenshotArea, nodeOf: (ref: string) => number): Promise<string> {
  const capture = async (params: Readonly<Record<string, unknown>>): Promise<string> => (await call(session, 'Page.captureScreenshot', { format: 'png', ...params }, Captured)).data;
  switch (area.kind) {
    case 'viewport':
      return capture({});
    case 'full-page': {
      const { cssContentSize } = await layoutMetrics(session);
      const clip = { x: 0, y: 0, width: Math.min(cssContentSize.width, MAX_CAPTURE_PX), height: Math.min(cssContentSize.height, MAX_CAPTURE_PX), scale: 1 };
      return capture({ captureBeyondViewport: true, clip });
    }
    case 'element': {
      const box = await boxOf(session, nodeOf(area.ref));
      const { cssVisualViewport: viewport } = await layoutMetrics(session);
      return capture({ captureBeyondViewport: true, clip: { x: box.x + viewport.pageX, y: box.y + viewport.pageY, width: box.width, height: box.height, scale: 1 } });
    }
  }
}

/** Follows the tab's JavaScript dialogs (alert, confirm, prompt, leave-page). */
export function watchDialogs(session: CdpSession, changed: (dialog: BrowserDialog | null) => void): void {
  session.on('Page.javascriptDialogOpening', (params) => {
    const { message, type, defaultPrompt } = DialogOpening.parse(params);
    changed({ type, message, defaultPrompt: defaultPrompt ?? '' });
  });
  session.on('Page.javascriptDialogClosed', () => {
    changed(null);
  });
}
