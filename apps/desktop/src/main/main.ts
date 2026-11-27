import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import type { BridgeChannels } from '../renderer/bridge.ts';
import { APP_ID, PRODUCT_NAME } from './app-identity.ts';
import { openEventStream, type EventStream } from './event-stream.ts';
import { superviseHost } from './host-supervisor.ts';
import { checkSender, IpcRefusedError, parseCopyText, parseSubscription, proxyRequest, type HostTarget, type IpcSender } from './ipc-proxy.ts';

const RENDERER_URL = pathToFileURL(fileURLToPath(new URL('../../dist/renderer/index.html', import.meta.url))).href;
const PRELOAD = fileURLToPath(new URL('../preload/preload.cjs', import.meta.url));
const HOST_MAIN = fileURLToPath(new URL('../../../host/src/main.ts', import.meta.url));

const CHANNELS: BridgeChannels = {
  request: 'morrowbot:request',
  event: 'morrowbot:event',
  subscribe: 'morrowbot:subscribe',
  hostReady: 'morrowbot:host-ready',
  pickFolder: 'morrowbot:pick-folder',
  copyText: 'morrowbot:copy-text',
};

type Lifetime = 'running' | 'stopping-host' | 'host-stopped';

const RECONNECT_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function report(error: unknown): void {
  console.error('MorrowBot:', error);
}

function runApp(): void {
  let window: BrowserWindow | undefined;
  let events: EventStream | undefined;
  let lifetime: Lifetime = 'running';

  function openWindow(): void {
    if (window !== undefined) {
      if (window.isMinimized()) window.restore();
      window.focus();
      return;
    }
    const opened = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 720,
      minHeight: 480,
      title: PRODUCT_NAME,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    opened.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    opened.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    opened.webContents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    opened.on('closed', () => {
      if (window === opened) window = undefined;
    });
    window = opened;
    void opened.loadURL(RENDERER_URL);
  }

  function senderOf(event: IpcMainEvent | IpcMainInvokeEvent): IpcSender {
    const frame = event.senderFrame;
    if (frame === null) return { kind: 'missing-frame' };
    const ours = window !== undefined && event.sender.id === window.webContents.id;
    return { kind: 'frame', url: frame.url, isMainFrame: ours && frame.parent === null };
  }

  /** Follows the host's events; if the socket drops while the host lives, reconnects and has the window reload. */
  function connect(target: HostTarget, delayMs: number): void {
    events?.close();
    events = openEventStream(target, {
      onEvent: (event) => window?.webContents.send(CHANNELS.event, event),
      report,
      onOpen: () => {
        delayMs = RECONNECT_MS;
        window?.webContents.send(CHANNELS.hostReady);
      },
      onLost: () => {
        setTimeout(() => {
          if (lifetime === 'running' && host.target() === target) connect(target, Math.min(delayMs * 2, RECONNECT_MAX_MS));
        }, delayMs);
      },
    });
  }

  const host = superviseHost(HOST_MAIN, {
    ready: (target) => {
      connect(target, RECONNECT_MS);
    },
    alreadyRunning: () => {
      void dialog
        .showMessageBox({ type: 'info', message: 'MorrowBot is already running', buttons: ['Quit'] })
        .then(() => {
          app.quit();
        });
    },
    fatal: (message) => {
      events?.close();
      events = undefined;
      dialog.showErrorBox('MorrowBot host stopped', message);
    },
  });

  ipcMain.handle(CHANNELS.request, async (event, input: unknown) => {
    try {
      return await proxyRequest({ sender: senderOf(event), rendererUrl: RENDERER_URL, input, host: host.target() });
    } catch (error) {
      if (error instanceof IpcRefusedError) console.warn(`MorrowBot: refused an IPC request: ${error.message}`);
      throw error;
    }
  });

  ipcMain.on(CHANNELS.subscribe, (event, input: unknown) => {
    try {
      events?.send(parseSubscription({ sender: senderOf(event), rendererUrl: RENDERER_URL, input }));
    } catch (error) {
      if (error instanceof IpcRefusedError) console.warn(`MorrowBot: refused an IPC subscription: ${error.message}`);
      else report(error);
    }
  });

  let picking = false;
  ipcMain.handle(CHANNELS.pickFolder, async (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    if (picking || window === undefined) return null;
    picking = true;
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const picked = await dialog.showOpenDialog(window, options).finally(() => {
      picking = false;
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  ipcMain.handle(CHANNELS.copyText, (event, input: unknown) =>
    clipboard.writeText(parseCopyText({ sender: senderOf(event), rendererUrl: RENDERER_URL, input })),
  );

  app.on('second-instance', openWindow);
  app.on('activate', openWindow);
  app.on('window-all-closed', () => {
    // Closing the last window keeps the app and its host running.
  });
  app.on('before-quit', (event) => {
    switch (lifetime) {
      case 'host-stopped':
        return;
      case 'stopping-host':
        event.preventDefault();
        return;
      case 'running':
        event.preventDefault();
        lifetime = 'stopping-host';
        events?.close();
        void host.stop().finally(() => {
          lifetime = 'host-stopped';
          app.quit();
        });
        return;
    }
  });

  void app.whenReady().then(openWindow);
}

app.setName(PRODUCT_NAME);
app.setAppUserModelId(APP_ID);
if (app.requestSingleInstanceLock()) runApp();
else app.quit();
