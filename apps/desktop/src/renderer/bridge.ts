import type { Cursor, EventServerFrame } from '@morrowbot/contracts';

/** The IPC channels between the preload script and Electron main. */
export interface BridgeChannels {
  readonly request: 'morrowbot:request';
  readonly event: 'morrowbot:event';
  readonly subscribe: 'morrowbot:subscribe';
  readonly hostRestarted: 'morrowbot:host-restarted';
}

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
  /** The host crashed and was restarted: anything held from the API is stale and must be reloaded. */
  onHostRestarted(listener: () => void): () => void;
}
