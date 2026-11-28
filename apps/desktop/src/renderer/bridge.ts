import type { Cursor, EventServerFrame } from '@morrowbot/contracts';

/** The IPC channels between the preload script and Electron main. */
export interface BridgeChannels {
  readonly request: 'morrowbot:request';
  readonly event: 'morrowbot:event';
  readonly subscribe: 'morrowbot:subscribe';
  readonly hostReady: 'morrowbot:host-ready';
  readonly hostLost: 'morrowbot:host-lost';
  readonly pickFolder: 'morrowbot:pick-folder';
  readonly copyText: 'morrowbot:copy-text';
  readonly openExternal: 'morrowbot:open-external';
  readonly revealPath: 'morrowbot:reveal-path';
  readonly appInfo: 'morrowbot:app-info';
  readonly loginItem: 'morrowbot:login-item';
  readonly setOpenAtLogin: 'morrowbot:set-open-at-login';
  readonly relaunch: 'morrowbot:relaunch';
  readonly updateStatus: 'morrowbot:update-status';
  readonly updateChanged: 'morrowbot:update-changed';
  readonly checkForUpdates: 'morrowbot:check-for-updates';
  readonly restartToUpdate: 'morrowbot:restart-to-update';
  readonly signInTerminal: 'morrowbot:sign-in-terminal';
  readonly providerInstallCapabilities: 'morrowbot:provider-install-capabilities';
  readonly installProvider: 'morrowbot:install-provider';
  readonly cancelProviderInstall: 'morrowbot:cancel-provider-install';
  readonly providerInstallProgress: 'morrowbot:provider-install-progress';
  readonly resetPlan: 'morrowbot:reset-plan';
  readonly runReset: 'morrowbot:run-reset';
  readonly serverMode: 'morrowbot:server-mode';
  readonly chooseServer: 'morrowbot:choose-server';
  readonly fileAction: 'morrowbot:file-action';
}

/** The scheme the window loads reply attachments from: `morrowbot-file://reply/<id>`, served by main with the host token. */
export const REPLY_FILE_SCHEME = 'morrowbot-file';

/** How opening or saving a reply attachment went. */
export type FileActionResult =
  | { readonly kind: 'opened' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Which server this app uses: none chosen yet (first launch), its own (a host this app starts), or one it joined.
 * A joined server is client-only: no host runs here, and the server never reaches this computer's files or terminal.
 */
export type ServerMode =
  | { readonly kind: 'choosing' }
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly url: string; readonly hostName: string };

/** Start this computer's own server, or join one with a pasted link or an address and code. */
export type ServerRequest =
  | { readonly kind: 'local' }
  | { readonly kind: 'join'; readonly link: string; readonly url: string; readonly code: string };

/** `ready`: in use now (first launch). `restarting`: saved, and MorrowBot reopens on it. */
export type ServerAnswer = { readonly kind: 'ready' } | { readonly kind: 'restarting' } | { readonly kind: 'failed'; readonly message: string };

/** A folder or file to show in Finder, named by an opaque id; desktop main resolves the path itself. */
export type RevealTarget =
  | { readonly kind: 'data-dir' }
  | { readonly kind: 'plugins-dir' }
  | { readonly kind: 'agent-workspace'; readonly agentId: string }
  /** A SOUL.md copy kept by Save a copy; `revealId` is the file name the host returned. */
  | { readonly kind: 'instructions-copy'; readonly agentId: string; readonly revealId: string }
  /** A skills folder, made first if it is not there yet. */
  | { readonly kind: 'global-skills' }
  | { readonly kind: 'agent-skills'; readonly agentId: string };

/** Open at login: only the installed app on macOS and Windows can register a login item. */
export type LoginItem = { readonly kind: 'unsupported' } | { readonly kind: 'supported'; readonly openAtLogin: boolean };

/** The installed app's own updates. A dev run is `unsupported`; `failed` keeps its reason in main's log. */
export type UpdateStatus =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'failed' };

/** A one-click sign-in: Terminal opened with the provider's own sign-in command, or why it could not. */
export type SignInLaunch = { readonly kind: 'opened' } | { readonly kind: 'unavailable'; readonly reason: string };

/** Opening an http(s) URL in the default browser: opened, or why it could not. */
export type ExternalOpenResult = { readonly kind: 'opened' } | { readonly kind: 'failed'; readonly reason: string };

export type ProviderInstallMode = 'install' | 'update';

/** How a built-in provider can be installed on this computer: 1-click via an allowlisted package manager, or a verified download page. */
export type ProviderInstallCapability =
  | { readonly kind: 'auto'; readonly tool: 'npm' | 'brew' }
  | { readonly kind: 'download'; readonly label: string; readonly url: string };

export type ProviderInstallCapabilities = Readonly<Record<string, ProviderInstallCapability>>;

/** Outcome of a 1-click built-in provider install or update. */
export type ProviderInstallResult =
  | { readonly kind: 'installed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly reason: string; readonly downloadUrl: string | null };

/** Live status pushed from main while a built-in provider install or update runs. */
export interface ProviderInstallProgress {
  readonly providerId: string;
  readonly mode: ProviderInstallMode;
  readonly phase: 'running' | 'done' | 'failed' | 'cancelled';
  readonly detail: string;
}

/** Settings › About › Reset or Uninstall: start fresh, remove the app, or remove the app and all its data. */
export type ResetChoice = 'reset' | 'uninstall-app' | 'full-uninstall';

/** One thing a reset or uninstall does, with the exact path or Keychain item. */
export type ResetStep =
  | { readonly kind: 'delete'; readonly path: string }
  | { readonly kind: 'trash'; readonly path: string }
  | { readonly kind: 'keychain'; readonly service: string; readonly account: string };

/** A path that stays, and why. */
export interface KeptPath {
  readonly path: string;
  readonly reason: string;
}

export type ResetOption =
  | { readonly kind: 'available'; readonly choice: ResetChoice; readonly steps: readonly ResetStep[]; readonly kept: readonly KeptPath[] }
  | { readonly kind: 'unavailable'; readonly choice: ResetChoice; readonly reason: string };

/** Every choice as main resolved it just now. `token` names this exact list; running a choice needs it. */
export interface ResetPlan {
  readonly token: string;
  readonly options: readonly ResetOption[];
}

/** `quitting`: the host stopped and MorrowBot is quitting to finish. `refused`: nothing was touched. */
export type ResetOutcome = { readonly kind: 'quitting' } | { readonly kind: 'refused'; readonly reason: string };

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A local API response as the renderer sees it: no headers, so no credentials. */
export interface ApiReply {
  readonly status: number;
  readonly body: unknown;
}

/** What the preload script exposes as `window.morrowbot`. */
export interface MorrowbotBridge {
  /** Calls the local API. `path` must start with `/api/`. */
  request(method: ApiMethod, path: string, body?: unknown): Promise<ApiReply>;
  /**
   * Every frame from the host's event stream: global events, events of subscribed threads, and
   * `resync` (refetch `/api/threads/:id/state`, then subscribe at its cursor). Returns an unsubscribe function.
   */
  onEvent(listener: (frame: EventServerFrame) => void): () => void;
  /** Starts a thread's events after `since` (its `/state` cursor), or from now on with `null`. */
  subscribe(threadId: string, since: Cursor | null): void;
  unsubscribe(threadId: string): void;
  /** The host started, or restarted after a crash with a new epoch: reload everything held from the API. */
  onHostReady(listener: () => void): () => void;
  /** The host's event stream dropped: the host may be restarting or down until the next `onHostReady`. */
  onHostLost(listener: () => void): () => void;
  /** Asks the user for a folder with the system dialog; null when they cancel. */
  pickFolder(): Promise<string | null>;
  /** Puts text on the system clipboard. */
  copyText(text: string): Promise<void>;
  /** Opens an http or https link in the system browser; main refuses every other scheme. Parse with `ExternalOpenResult`. */
  openExternal(url: string): Promise<unknown>;
  /** Shows a folder in Finder. The renderer never sends a path. */
  revealPath(target: RevealTarget): Promise<void>;
  /** Version, home folder, user name and data folder, for `shared/privacy.ts` and About only. Parse with `AppInfo`. */
  appInfo(): Promise<unknown>;
  /** Whether MorrowBot opens at login, where the installed app supports it. Parse with `LoginItem`. */
  loginItem(): Promise<unknown>;
  /** Turns open-at-login on or off; answers like `loginItem()`. */
  setOpenAtLogin(open: boolean): Promise<unknown>;
  /** Saves whether the next launch starts in safe mode (no plugin starts), then restarts MorrowBot. */
  relaunch(options: { readonly safeMode: boolean }): Promise<void>;
  /** Where the app's own update stands. Parse with `UpdateStatus`. */
  updateStatus(): Promise<unknown>;
  /** Every change to the update status. Returns an unsubscribe function. */
  onUpdateStatus(listener: (status: unknown) => void): () => void;
  /** Checks for an update now; answers like `updateStatus()`. */
  checkForUpdates(): Promise<unknown>;
  /** Quits, installs the downloaded update and reopens MorrowBot. */
  restartToUpdate(): Promise<void>;
  /**
   * Opens Terminal on macOS with a built-in provider's own sign-in command, which main reads from
   * the host; the renderer names only the provider. Parse with `SignInLaunch`.
   */
  signInTerminal(providerId: string): Promise<unknown>;
  /** Which built-in providers support 1-click install on this computer. Parse with `ProviderInstallCapabilities`. */
  providerInstallCapabilities(): Promise<unknown>;
  /** Runs the strictly allowlisted installer or updater for a built-in provider. Parse with `ProviderInstallResult`. */
  installProvider(request: { readonly providerId: string; readonly mode: ProviderInstallMode }): Promise<unknown>;
  /** Cancels an in-flight built-in provider install or update. */
  cancelProviderInstall(providerId: string): Promise<void>;
  /** Live progress updates while a built-in provider installs or updates. Returns an unsubscribe function. */
  onProviderInstallProgress(listener: (progress: unknown) => void): () => void;
  /** Resolves every reset and uninstall choice to exact paths. Parse with `ResetPlan`. */
  resetPlan(): Promise<unknown>;
  /** Runs a choice from the plan `token` names, after main checks nothing changed. Parse with `ResetOutcome`. */
  runReset(request: { readonly choice: ResetChoice; readonly token: string }): Promise<unknown>;
  /** Which server this app uses. Parse with `ServerMode` from `shared/server.ts`. */
  serverMode(): Promise<unknown>;
  /** Picks or switches the server; answers a `ServerAnswer`. */
  chooseServer(request: ServerRequest): Promise<unknown>;
  /** Opens a reply attachment in its viewer app, or saves it and shows it in Finder. Parse with `FileActionResult`. */
  fileAction(request: { readonly action: 'open' | 'save'; readonly id: string; readonly name: string }): Promise<unknown>;
}
