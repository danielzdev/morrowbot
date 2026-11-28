import { autoUpdater as nativeUpdater } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../renderer/bridge.ts';
import { feedOf, readBuiltRepo, readKeychainToken } from './release-feed.ts';

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1_000;

export interface Updater {
  status(): UpdateStatus;
  /** Checks now, unless a check, a download or a ready update is already under way. */
  check(): UpdateStatus;
  /** Quits and installs a staged update, once; does nothing until one is ready. Stop the host first. */
  restart(): void;
  /** Holds every check, timed or asked for, until `resume`; one already under way carries on. */
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface UpdaterOptions {
  readonly env: NodeJS.ProcessEnv;
  /** `app.getAppPath()`, whose package.json names the repo this build was published to. */
  readonly appPath: string;
  readonly onStatus: (status: UpdateStatus) => void;
  readonly report: (error: unknown) => void;
}

/** Only the installed app updates itself; every other run reports `unsupported`. */
export const NO_UPDATER: Updater = {
  status: () => ({ kind: 'unsupported' }),
  check: () => ({ kind: 'unsupported' }),
  restart: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  stop: () => undefined,
};

/**
 * Keeps the installed app up to date: checks soon after launch and every 4 hours, downloads in the
 * background, and installs on restart or quit. An update is `ready` only once Squirrel has staged it.
 */
export function startUpdater({ env, appPath, onStatus, report }: UpdaterOptions): Updater {
  const { autoUpdater } = electronUpdater;
  const builtRepo = readBuiltRepo(appPath);
  let status: UpdateStatus = { kind: 'idle' };
  let downloaded: string | null = null;
  let restarting = false;
  let paused = false;
  const set = (next: UpdateStatus): void => {
    status = next;
    onStatus(next);
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => {
    downloaded = null;
    set({ kind: 'checking' });
  });
  autoUpdater.on('update-not-available', () => { set({ kind: 'up-to-date' }); });
  autoUpdater.on('update-available', (info) => { set({ kind: 'downloading', version: info.version, percent: 0 }); });
  autoUpdater.on('download-progress', (progress) => {
    const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, Math.floor(progress.percent))) : 0;
    if (status.kind === 'downloading') set({ ...status, percent });
  });
  autoUpdater.on('update-downloaded', (info) => { downloaded = info.version; });
  nativeUpdater.on('update-downloaded', () => {
    if (downloaded !== null) set({ kind: 'ready', version: downloaded });
  });
  autoUpdater.on('error', (error) => {
    downloaded = null;
    report(error);
    set({ kind: 'failed' });
  });

  /** Points electron-updater at the feed, reading the Keychain token afresh so a token added later is used. */
  const useFeed = async (): Promise<boolean> => {
    const keychainToken = env.ORIKAMI_RELEASES_TOKEN === undefined ? await readKeychainToken() : null;
    const feed = feedOf({ env, builtRepo: await builtRepo, keychainToken });
    switch (feed.kind) {
      case 'invalid':
        report(new Error(feed.problem));
        return false;
      case 'github': {
        const { owner, repo, token } = feed;
        autoUpdater.setFeedURL(token === null ? { provider: 'github', owner, repo } : { provider: 'github', owner, repo, token });
        return true;
      }
    }
  };
  const check = (): UpdateStatus => {
    if (paused) return status;
    if (status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'ready') return status;
    set({ kind: 'checking' });
    const run = async (): Promise<void> => {
      if (!(await useFeed())) {
        set({ kind: 'failed' });
        return;
      }
      const result = await autoUpdater.checkForUpdates();
      await result?.downloadPromise;
    };
    run().catch((error: unknown) => {
      report(error);
      set({ kind: 'failed' });
    });
    return status;
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  return {
    status: () => status,
    check,
    restart: () => {
      if (status.kind !== 'ready' || restarting) return;
      restarting = true;
      autoUpdater.quitAndInstall();
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
