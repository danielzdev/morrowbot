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
}

/** A folder to show in Finder, named by an opaque id; desktop main resolves the path itself. */
export type RevealTarget = { readonly kind: 'data-dir' } | { readonly kind: 'agent-workspace'; readonly agentId: string };

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
}
