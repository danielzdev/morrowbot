import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../renderer/bridge.ts';
import { feedOf, readBuiltRepo, readKeychainToken } from './release-feed.ts';

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1_000;

export interface Updater {
  status(): UpdateStatus;
  /** Checks now, unless a check, a download or a ready update is already under way. */
  check(): UpdateStatus;
  /** Quits and installs a downloaded update; does nothing until one is ready. */
  restart(): void;
  stop(): void;
}

export interface UpdaterOptions {
  readonly env: NodeJS.ProcessEnv;
  /** `app.getAppPath()`, whose package.json names the repo this build was published to. */
  readonly appPath: string;
  readonly onStatus: (status: UpdateStatus) => void;
  readonly report: (error: unknown) => void;
}

/** A dev run never updates itself. */
export const NO_UPDATER: Updater = {
  status: () => ({ kind: 'unsupported' }),
  check: () => ({ kind: 'unsupported' }),
  restart: () => undefined,
  stop: () => undefined,
};

/** Keeps the installed app up to date: checks soon after launch and every 4 hours, downloads in the background, installs on restart or quit. */
export function startUpdater({ env, appPath, onStatus, report }: UpdaterOptions): Updater {
  const { autoUpdater } = electronUpdater;
  let status: UpdateStatus = { kind: 'idle' };
  const set = (next: UpdateStatus): void => {
    status = next;
    onStatus(next);
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => { set({ kind: 'checking' }); });
  autoUpdater.on('update-not-available', () => { set({ kind: 'up-to-date' }); });
  autoUpdater.on('update-available', (info) => { set({ kind: 'downloading', version: info.version, percent: 0 }); });
  autoUpdater.on('download-progress', (progress) => {
    if (status.kind === 'downloading') set({ ...status, percent: Math.floor(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => { set({ kind: 'ready', version: info.version }); });
  autoUpdater.on('error', (error) => {
    report(error);
    if (status.kind !== 'ready') set({ kind: 'failed' });
  });

  const configured = Promise.all([readBuiltRepo(appPath), readKeychainToken()]).then(([builtRepo, keychainToken]) => {
    const feed = feedOf({ env, builtRepo, keychainToken });
    switch (feed.kind) {
      case 'invalid':
        report(new Error(feed.problem));
        return false;
      case 'github': {
        const { owner, repo, token } = feed;
        autoUpdater.setFeedURL(token === null ? { provider: 'github', owner, repo } : { provider: 'github', owner, repo, private: true, token });
        return true;
      }
    }
  });
  const check = (): UpdateStatus => {
    if (status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'ready') return status;
    set({ kind: 'checking' });
    void configured.then(
      async (ok) => {
        if (ok) await autoUpdater.checkForUpdates();
        else set({ kind: 'failed' });
      },
      (error: unknown) => {
        report(error);
        set({ kind: 'failed' });
      },
    ).catch(() => {
      if (status.kind !== 'ready') set({ kind: 'failed' });
    });
    return status;
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  return {
    status: () => status,
    check,
    restart: () => {
      if (status.kind === 'ready') autoUpdater.quitAndInstall();
    },
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
