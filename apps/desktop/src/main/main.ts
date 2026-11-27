import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { BridgeChannels } from '../renderer/bridge.ts';
import { APP_ID, PRODUCT_NAME } from './app-identity.ts';
import { openEventStream, type EventStream } from './event-stream.ts';
import { superviseHost } from './host-supervisor.ts';
import { IpcRefusedError, parseSubscription, proxyRequest, type IpcSender } from './ipc-proxy.ts';

const RENDERER_URL = pathToFileURL(fileURLToPath(new URL('../renderer/index.html', import.meta.url))).href;
const PRELOAD = fileURLToPath(new URL('../preload/preload.cjs', import.meta.url));
const HOST_MAIN = fileURLToPath(new URL('../../../host/src/main.ts', import.meta.url));

const CHANNELS: BridgeChannels = {
  request: 'morrowbot:request',
  event: 'morrowbot:event',
  subscribe: 'morrowbot:subscribe',
  hostRestarted: 'morrowbot:host-restarted',
};

type Lifetime = 'running' | 'stopping-host' | 'host-stopped';

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
      width: 960,
      height: 640,
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

  const host = superviseHost(HOST_MAIN, {
    ready: (target, restarted) => {
      events?.close();
      events = openEventStream(target, (event) => window?.webContents.send(CHANNELS.event, event), report);
      if (restarted) window?.webContents.send(CHANNELS.hostRestarted);
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
