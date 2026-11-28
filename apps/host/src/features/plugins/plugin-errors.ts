import type { CrashReason, PluginErrorCode } from '@morrowbot/contracts';

export interface PluginTimeouts {
  readonly initMs: number;
  readonly healthMs: number;
  readonly shutdownMs: number;
  /** The first `provider-info` of a worker may install or update things; later ones are shorter. */
  readonly firstInfoMs: number;
  readonly infoMs: number;
  readonly usageMs: number;
  readonly routeInfoMs: number;
  readonly toolsListMs: number;
  /** Covers long human-in-the-loop tool calls such as browser takeover (15 min limit). */
  readonly toolCallMs: number;
  /** How long Stop waits for `turn-end` before the host kills the worker. */
  readonly turnStopMs: number;
}

export const DEFAULT_PLUGIN_TIMEOUTS: PluginTimeouts = {
  initMs: 10_000,
  healthMs: 5_000,
  shutdownMs: 3_000,
  firstInfoMs: 120_000,
  infoMs: 30_000,
  usageMs: 15_000,
  routeInfoMs: 15_000,
  toolsListMs: 10_000,
  toolCallMs: 16 * 60_000,
  turnStopMs: 5_000,
};

export type PluginExit = { readonly kind: 'expected' } | { readonly kind: 'crashed'; readonly reason: CrashReason };

/** The plugin answered a request with an error. Its process is still running. */
export class PluginRequestError extends Error {
  readonly code: PluginErrorCode;

  constructor(code: PluginErrorCode, message: string) {
    super(message);
    this.name = 'PluginRequestError';
    this.code = code;
  }
}

/** The plugin did not answer one request in time. Only that request fails; the process keeps running. */
export class PluginTimeoutError extends Error {
  constructor(request: string) {
    super(`The plugin did not answer "${request}" in time`);
    this.name = 'PluginTimeoutError';
  }
}

/** The plugin process stopped before it answered. */
export class PluginGoneError extends Error {
  constructor() {
    super('The plugin process stopped before it answered');
    this.name = 'PluginGoneError';
  }
}

/** The caller cancelled an in-flight plugin request before it answered. */
export class PluginCancelledError extends Error {
  constructor() {
    super('The plugin request was cancelled');
    this.name = 'PluginCancelledError';
  }
}
