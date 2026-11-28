import type { EventServerFrame } from '@morrowbot/contracts';
import { openEventStream, type EventStream } from '../main/event-stream.ts';
import { parseSubscription, proxyRequest, type HostTarget, type IpcSender } from '../main/ipc-proxy.ts';
import { parseFileAction, runFileAction } from '../main/reply-files.ts';
import type { MorrowbotBridge } from '../renderer/bridge.ts';

const RENDERER_URL = 'file:///Applications/MorrowBot.app/Contents/Resources/app/dist/renderer/index.html';
const PAGE: IpcSender = { kind: 'frame', url: RENDERER_URL, isMainFrame: true };

/**
 * The window's `window.morrowbot`, served by Electron main's own sender check, proxy and event stream
 * against a real host. Only Electron's IPC transport is left out. Everything that reaches the
 * renderer is kept, so a test can check that the token never does.
 */
export interface TestWindow {
  readonly bridge: MorrowbotBridge;
  /** What main does when a host becomes ready: a new event stream, then `host-ready` to the renderer. Like main, a dropped stream sends `host-lost`. */
  connect(target: HostTarget): void;
  /** The event socket drops while the host lives: main sends `host-lost`, then reconnects with `connect`. */
  dropStream(): void;
  /** Everything the renderer received, as JSON. */
  received(): string;
  close(): void;
}

/** Where a test window's file actions write: files it opens, and the path a Save dialog would answer (null cancels). */
export interface TestFiles {
  readonly openDir: string;
  readonly saveTo: (name: string) => string | null;
}

export function openTestWindow(target: HostTarget, files?: TestFiles): TestWindow {
  let host = target;
  let events: EventStream | undefined;
  const frames = new Set<(frame: EventServerFrame) => void>();
  const ready = new Set<() => void>();
  const lost = new Set<() => void>();
  const seen: unknown[] = [];
  const deliver = (frame: EventServerFrame): void => {
    seen.push(frame);
    for (const listener of frames) listener(frame);
  };
  const report = (error: unknown): void => {
    seen.push({ streamError: String(error) });
  };
  const listen = <T>(set: Set<T>, listener: T): (() => void) => {
    set.add(listener);
    return () => set.delete(listener);
  };
  const onLost = (): void => {
    for (const listener of lost) listener();
  };
  const connect = (next: HostTarget): void => {
    host = next;
    events?.close();
    events = openEventStream(next, { onEvent: deliver, report, onLost });
    for (const listener of ready) listener();
  };
  events = openEventStream(host, { onEvent: deliver, report, onLost });
  const bridge: MorrowbotBridge = {
    request: async (method, path, body) => {
      const reply = await proxyRequest({ sender: PAGE, rendererUrl: RENDERER_URL, input: { method, path, body }, host });
      seen.push(reply);
      return reply;
    },
    onEvent: (listener) => listen(frames, listener),
    subscribe: (threadId, since) => {
      events?.send(parseSubscription({ sender: PAGE, rendererUrl: RENDERER_URL, input: { kind: 'subscribe', threadId, since } }));
    },
    unsubscribe: (threadId) => {
      events?.send(parseSubscription({ sender: PAGE, rendererUrl: RENDERER_URL, input: { kind: 'unsubscribe', threadId } }));
    },
    onHostReady: (listener) => listen(ready, listener),
    onHostLost: (listener) => listen(lost, listener),
    pickFolder: () => Promise.resolve(null),
    copyText: () => Promise.resolve(),
    openExternal: () => Promise.resolve({ kind: 'opened' }),
    revealPath: () => Promise.resolve(),
    appInfo: () => Promise.resolve({ appVersion: '0.0.0', homeDir: '/Users/tester', userName: 'tester', dataDir: '/Users/tester/.morrowbot' }),
    loginItem: () => Promise.resolve({ kind: 'unsupported' }),
    setOpenAtLogin: () => Promise.resolve({ kind: 'unsupported' }),
    relaunch: (options) => {
      seen.push({ relaunch: options });
      return Promise.resolve();
    },
    updateStatus: () => Promise.resolve({ kind: 'unsupported' }),
    onUpdateStatus: () => () => undefined,
    checkForUpdates: () => Promise.resolve({ kind: 'unsupported' }),
    restartToUpdate: () => Promise.resolve(),
    signInTerminal: () => Promise.resolve({ kind: 'unavailable', reason: 'One-click sign-in works on macOS only. Use the command instead.' }),
    providerInstallCapabilities: () => Promise.resolve({}),
    installProvider: () => Promise.resolve({ kind: 'failed', reason: 'Not in tests.', downloadUrl: null }),
    cancelProviderInstall: () => Promise.resolve(),
    onProviderInstallProgress: () => () => undefined,
    resetPlan: () => Promise.resolve({ token: 'test', options: [] }),
    runReset: () => Promise.resolve({ kind: 'refused', reason: 'Not in tests.' }),
    serverMode: () => Promise.resolve({ kind: 'local' }),
    chooseServer: () => Promise.resolve({ kind: 'failed', message: 'A test window keeps its server' }),
    fileAction: async (request) => {
      if (files === undefined) return { kind: 'failed', reason: 'Not in tests.' };
      const result = await runFileAction(parseFileAction({ sender: PAGE, rendererUrl: RENDERER_URL, input: request }), {
        host,
        openDir: () => Promise.resolve(files.openDir),
        saveTo: (name) => Promise.resolve(files.saveTo(name)),
        open: (file) => {
          seen.push({ opened: file });
          return Promise.resolve('');
        },
        reveal: (file) => {
          seen.push({ revealed: file });
        },
      });
      seen.push(result);
      return result;
    },
  };
  return {
    bridge,
    connect,
    dropStream: () => {
      events?.close();
      onLost();
    },
    received: () => JSON.stringify(seen),
    close: () => {
      events?.close();
    },
  };
}
