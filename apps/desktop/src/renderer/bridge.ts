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
  readonly serverMode: 'morrowbot:server-mode';
  readonly chooseServer: 'morrowbot:choose-server';
}

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
  /** An AGENTS.md copy kept by Save a copy; `revealId` is the file name the host returned. */
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
  /** Opens an http or https link in the system browser; main refuses every other scheme. */
  openExternal(url: string): Promise<void>;
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
  /** Which server this app uses. Parse with `ServerMode` from `shared/server.ts`. */
  serverMode(): Promise<unknown>;
  /** Picks or switches the server; answers a `ServerAnswer`. */
  chooseServer(request: ServerRequest): Promise<unknown>;
}
