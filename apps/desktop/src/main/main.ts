import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type OpenDialogOptions, type BrowserWindowConstructorOptions } from 'electron';
import { APP_ID, PRODUCT_NAME } from './app-identity.ts';
import { appFilesOf } from './app-files.ts';
import { CHANNELS } from './channels.ts';
import { openEventStream, type EventStream } from './event-stream.ts';
import { superviseHost } from './host-supervisor.ts';
import { parseServerRequest, pickServer } from './join-server.ts';
import { checkSender, IpcRefusedError, parseCopyText, parseSubscription, proxyRequest, type HostTarget, type IpcSender } from './ipc-proxy.ts';
import { readSafeMode, writeSafeMode } from './launch-prefs.ts';
import { readServerChoice, serverPlanOf, writeServerChoice } from './server-choice.ts';
import { openServerConnection } from './server-connection.ts';
import { NO_UPDATER, startUpdater, type Updater } from './updater.ts';
import { hostEnvOf, profileOf, type UsableProfile } from './profile.ts';
import { createProviderInstaller, parseCancelInstallRequest, parseInstallRequest } from './provider-installer.ts';
import { appInfoOf, loginItemOf, openExternalUrl, parseExternalUrl, parseOpenAtLogin, parseRelaunch, parseRevealTarget, pluginsDirOf, resolveReveal } from './shell-actions.ts';
import { openSignInTerminal, parseSignInRequest } from './sign-in-terminal.ts';
import { MAC_KEYCHAIN } from './reset/keychain.ts';
import { parseResetRequest, resetFlow } from './reset/reset-flow.ts';
import { resetInProgress } from './reset/reset-lock.ts';
import { resetWorkspaces, startCleanupHelper } from './reset/start-helper.ts';

/** The home folder with every link resolved, so the profile's data folder and every reset path agree with what the cleanup helper resolves. */
function resolvedHome(): string {
  try {
    return realpathSync(homedir());
  } catch {
    return homedir();
  }
}
const HOME_DIR = resolvedHome();
const FILES = appFilesOf(app.isPackaged ? { kind: 'packaged', appPath: app.getAppPath() } : { kind: 'dev' });
const RENDERER_URL = FILES.rendererUrl;

/** macOS keeps its traffic lights, inset into the window's own 48px top bar; elsewhere the system frame stays. */
const TITLE_BAR: BrowserWindowConstructorOptions =
  process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : {};

type Lifetime = 'running' | 'stopping-host' | 'host-stopped';

const RECONNECT_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function report(error: unknown): void {
  console.error('Ori Kami:', error);
}

function runApp(profile: UsableProfile): void {
  let window: BrowserWindow | undefined;
  let updater: Updater = NO_UPDATER;
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
      webPreferences: { preload: FILES.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
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
        window?.webContents.send(CHANNELS.hostLost);
        setTimeout(() => {
          if (lifetime === 'running' && server.target() === target) connect(target, Math.min(delayMs * 2, RECONNECT_MAX_MS));
        }, delayMs);
      },
    });
  }

  const { dataDir } = profile;
  const hostEnv: NodeJS.ProcessEnv = {
    ...hostEnvOf(profile, process.env),
    ...(FILES.builtinPluginsDir === null ? {} : { ORIKAMI_BUILTIN_PLUGINS_DIR: FILES.builtinPluginsDir }),
    ...(readSafeMode(dataDir) ? { ORIKAMI_SAFE_MODE: '1' } : {}),
  };
  const startLocal = () => superviseHost({ main: FILES.hostMain, env: hostEnv }, {
    ready: (target) => {
      connect(target, RECONNECT_MS);
    },
    alreadyRunning: () => {
      void dialog
        .showMessageBox({ type: 'info', message: 'Ori Kami is already running', buttons: ['Quit'] })
        .then(() => {
          app.quit();
        });
    },
    fatal: (message) => {
      events?.close();
      events = undefined;
      dialog.showErrorBox('Ori Kami host stopped', message);
    },
  });
  const server = openServerConnection(serverPlanOf(readServerChoice(dataDir), dataDir), {
    startLocal,
    connectRemote: (target) => {
      connect(target, RECONNECT_MS);
    },
  });
  /** A joined server never reaches this computer: no folder picker, Finder or Terminal on its say-so. */
  const clientOnly = (): boolean => server.mode().kind === 'remote';

  ipcMain.handle(CHANNELS.request, async (event, input: unknown) => {
    try {
      return await proxyRequest({ sender: senderOf(event), rendererUrl: RENDERER_URL, input, host: server.target() });
    } catch (error) {
      if (error instanceof IpcRefusedError) console.warn(`Ori Kami: refused an IPC request: ${error.message}`);
      throw error;
    }
  });

  ipcMain.on(CHANNELS.subscribe, (event, input: unknown) => {
    try {
      events?.send(parseSubscription({ sender: senderOf(event), rendererUrl: RENDERER_URL, input }));
    } catch (error) {
      if (error instanceof IpcRefusedError) console.warn(`Ori Kami: refused an IPC subscription: ${error.message}`);
      else report(error);
    }
  });

  let picking = false;
  ipcMain.handle(CHANNELS.pickFolder, async (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    if (picking || window === undefined || clientOnly()) return null;
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

  const fromRenderer = (event: IpcMainInvokeEvent, input: unknown) => ({ sender: senderOf(event), rendererUrl: RENDERER_URL, input });

  ipcMain.handle(CHANNELS.openExternal, (event, input: unknown) =>
    openExternalUrl(parseExternalUrl(fromRenderer(event, input)), {
      platform: process.platform,
      openWithElectron: (url) => shell.openExternal(url, { activate: true }),
      report,
    }),
  );

  ipcMain.handle(CHANNELS.revealPath, async (event, input: unknown) => {
    const target = parseRevealTarget(fromRenderer(event, input));
    if (clientOnly() && target.kind !== 'data-dir') throw new IpcRefusedError("A joined server's folders are not on this computer");
    shell.showItemInFolder(await resolveReveal(target, { dataDir, pluginsDir: pluginsDirOf(process.env, dataDir), host: server.target(), rendererUrl: RENDERER_URL }));
  });

  ipcMain.handle(CHANNELS.relaunch, (event, input: unknown) => {
    writeSafeMode(dataDir, parseRelaunch(fromRenderer(event, input)));
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(CHANNELS.signInTerminal, (event, input: unknown) => {
    const request = parseSignInRequest(fromRenderer(event, input));
    if (clientOnly()) return { kind: 'unavailable', reason: 'Engines run on the server you joined; its owner signs them in there.' };
    return openSignInTerminal(request, {
      host: server.target(),
      rendererUrl: RENDERER_URL,
      dataDir,
      platform: process.platform,
      open: (file) => shell.openPath(file),
    });
  });

  const installer = createProviderInstaller({
    platform: process.platform,
    host: () => server.target(),
    rendererUrl: RENDERER_URL,
    clientOnly,
    onProgress: (progress) => window?.webContents.send(CHANNELS.providerInstallProgress, progress),
  });
  ipcMain.handle(CHANNELS.providerInstallCapabilities, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return installer.capabilities();
  });
  ipcMain.handle(CHANNELS.installProvider, (event, input: unknown) => installer.install(parseInstallRequest(fromRenderer(event, input))));
  ipcMain.handle(CHANNELS.cancelProviderInstall, (event, input: unknown) => {
    installer.cancel(parseCancelInstallRequest(fromRenderer(event, input)));
  });

  ipcMain.handle(CHANNELS.serverMode, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return server.mode();
  });
  ipcMain.handle(CHANNELS.chooseServer, async (event, input: unknown) => {
    const request = parseServerRequest(fromRenderer(event, input));
    const picked = await pickServer(request, process.platform);
    if (picked.kind === 'failed') return picked;
    writeServerChoice(dataDir, picked.choice);
    if (server.choose(picked.choice)) return { kind: 'ready' };
    app.relaunch();
    app.quit();
    return { kind: 'restarting' };
  });

  ipcMain.handle(CHANNELS.appInfo, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return appInfoOf(app.getVersion(), dataDir);
  });

  const loginItems = profile.kind === 'installed' && (process.platform === 'darwin' || process.platform === 'win32');
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

  ipcMain.handle(CHANNELS.updateStatus, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return updater.status();
  });
  ipcMain.handle(CHANNELS.checkForUpdates, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return updater.check();
  });
  /** Stops the host once; both quitting and restarting to update wait for it. */
  function stopHost(): Promise<void> {
    lifetime = 'stopping-host';
    installer.stopAll();
    updater.stop();
    events?.close();
    return server.stop().finally(() => {
      lifetime = 'host-stopped';
    });
  }

  const reset = resetFlow({
    context: async () => ({
      platform: process.platform,
      homeDir: HOME_DIR,
      profile: { kind: profile.kind, dataDir },
      workspaces: await resetWorkspaces(server.mode(), server.target(), RENDERER_URL, dataDir),
    }),
    bundle: () => ({ packaged: app.isPackaged, execPath: process.execPath, updatePending: ['checking', 'downloading', 'ready'].includes(updater.status().kind) }),
    keychain: MAC_KEYCHAIN,
    updates: { pause: () => { updater.pause(); }, resume: () => { updater.resume(); } },
    loginItem: { isOn: () => loginItems && app.getLoginItemSettings().openAtLogin, set: (on) => { if (loginItems) app.setLoginItemSettings({ openAtLogin: on }); } },
    running: () => lifetime === 'running',
    stopHost,
    startHelper: (job) => startCleanupHelper(FILES.cleanupHelper, job),
    trash: (target) => shell.trashItem(target),
    relaunch: app.isPackaged ? { command: process.execPath, args: [], cwd: '/' } : { command: process.execPath, args: process.argv.slice(1), cwd: process.cwd() },
    mainPid: process.pid,
    quit: () => {
      app.quit();
    },
    recover: (message, restart) => {
      dialog.showErrorBox('Ori Kami could not finish', message);
      if (restart) app.relaunch();
      app.quit();
    },
  });
  ipcMain.handle(CHANNELS.resetPlan, (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    return reset.plan();
  });
  ipcMain.handle(CHANNELS.runReset, (event, input: unknown) => {
    const { choice, token } = parseResetRequest(fromRenderer(event, input));
    return reset.run(choice, token);
  });

  ipcMain.handle(CHANNELS.restartToUpdate, async (event) => {
    checkSender(senderOf(event), RENDERER_URL);
    if (updater.status().kind !== 'ready' || lifetime !== 'running') return;
    await stopHost();
    updater.restart();
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
        void stopHost().finally(() => {
          app.quit();
        });
        return;
    }
  });

  void app.whenReady().then(() => {
    openWindow();
    if (profile.kind === 'installed') {
      updater = startUpdater({
        env: process.env,
        appPath: app.getAppPath(),
        onStatus: (status) => {
          window?.webContents.send(CHANNELS.updateChanged, status);
          if (status.kind === 'failed' && lifetime === 'host-stopped') app.quit();
        },
        report,
      });
    }
  });
}

/** One instance per profile: the installed app keeps Electron's own profile and lock, any other run uses its own. */
function start(profile: UsableProfile): void {
  if (resetInProgress(profile.dataDir)) {
    dialog.showErrorBox('Ori Kami is finishing a reset', 'Open Ori Kami again in a moment. It reopens by itself once a reset is done.');
    app.exit(0);
    return;
  }
  if (profile.kind === 'isolated') app.setPath('userData', profile.userDataDir);
  if (app.requestSingleInstanceLock()) runApp(profile);
  else app.quit();
}

app.setName(PRODUCT_NAME);
app.setAppUserModelId(APP_ID);
const profile = profileOf({ packaged: app.isPackaged, env: process.env, homeDir: HOME_DIR });
switch (profile.kind) {
  case 'invalid':
    dialog.showErrorBox('Ori Kami could not start', profile.problem);
    app.exit(1);
    break;
  case 'installed':
  case 'isolated':
    start(profile);
    break;
}
