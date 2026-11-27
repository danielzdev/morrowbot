import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type OpenDialogOptions, type BrowserWindowConstructorOptions } from 'electron';
import type { BridgeChannels } from '../renderer/bridge.ts';
import { APP_ID, PRODUCT_NAME } from './app-identity.ts';
import { openEventStream, type EventStream } from './event-stream.ts';
import { superviseHost } from './host-supervisor.ts';
import { checkSender, IpcRefusedError, parseCopyText, parseSubscription, proxyRequest, type HostTarget, type IpcSender } from './ipc-proxy.ts';
import { appInfoOf, dataDirOf, loginItemOf, parseExternalUrl, parseOpenAtLogin, parseRevealTarget, resolveReveal } from './shell-actions.ts';

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
  openExternal: 'morrowbot:open-external',
  revealPath: 'morrowbot:reveal-path',
  appInfo: 'morrowbot:app-info',
  loginItem: 'morrowbot:login-item',
  setOpenAtLogin: 'morrowbot:set-open-at-login',
};

/** macOS keeps its traffic lights, inset into the window's own 48px top bar; elsewhere the system frame stays. */
const TITLE_BAR: BrowserWindowConstructorOptions =
  process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : {};

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
      show: false,
      ...TITLE_BAR,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    opened.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    opened.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    opened.webContents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    opened.once('ready-to-show', () => {
      opened.show();
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
    try {
      const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
      const picked = await dialog.showOpenDialog(window, options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    } finally {
      picking = false;
    }
  });

  ipcMain.handle(CHANNELS.copyText, (event, input: unknown) =>
    clipboard.writeText(parseCopyText({ sender: senderOf(event), rendererUrl: RENDERER_URL, input })),
  );

  const dataDir = dataDirOf(process.env);
  const fromRenderer = (event: IpcMainInvokeEvent, input: unknown) => ({ sender: senderOf(event), rendererUrl: RENDERER_URL, input });

  ipcMain.handle(CHANNELS.openExternal, (event, input: unknown) => shell.openExternal(parseExternalUrl(fromRenderer(event, input))));

  ipcMain.handle(CHANNELS.revealPath, async (event, input: unknown) => {
    const target = parseRevealTarget(fromRenderer(event, input));
    shell.showItemInFolder(await resolveReveal(target, { dataDir, host: host.target(), rendererUrl: RENDERER_URL }));
  });

  ipcMain.handle(CHANNELS.appInfo, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return appInfoOf(app.getVersion(), dataDir);
  });

  const loginItems = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
  const loginItem = () => loginItemOf(loginItems ? app.getLoginItemSettings().openAtLogin : null);
  ipcMain.handle(CHANNELS.loginItem, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return loginItem();
  });
  ipcMain.handle(CHANNELS.setOpenAtLogin, (event, input: unknown) => {
    const open = parseOpenAtLogin(fromRenderer(event, input));
    if (loginItems) app.setLoginItemSettings({ openAtLogin: open });
    return loginItem();
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
