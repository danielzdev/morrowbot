/**
 * Why talking to an MCP server failed. `auth`: the server refused the credentials (Reconnect needed);
 * `unreachable`: no answer, or not in time (Not responding); `exited`: a local server stopped (Crashed);
 * `protocol`: it does not speak a version or shape this host supports (Unsupported); `aborted`: the turn ended;
 * `rpc`: the server answered the request with a JSON-RPC error.
 * Messages never hold header values, environment values or keys.
 */
export type FailureKind = 'auth' | 'unreachable' | 'exited' | 'protocol' | 'aborted' | 'rpc';

export class McpFailure extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = 'McpFailure';
    this.kind = kind;
  }
}

/** One JSON-RPC conversation with an MCP server, over whichever transport reaches it. */
export interface McpChannel {
  /** Sends a request and settles with its `result`, or rejects with an `McpFailure`. Aborting sends `notifications/cancelled`. */
  request(method: string, params: object, signal: AbortSignal): Promise<unknown>;
  notify(method: string, params: object): Promise<void>;
  /** Called once if the channel ends without `close` (a local server exiting). */
  onEnd(listener: (failure: McpFailure) => void): void;
  /** After `initialize`: the protocol version later HTTP requests carry. */
  setProtocolVersion(version: string): void;
  close(): Promise<void>;
}

/** `signal`, also aborted after `ms`; a timeout reads as `unreachable`. */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

/** The failure an aborted signal stands for: the caller's abort, or the timeout. */
export function abortFailure(signal: AbortSignal, what: string): McpFailure {
  const reason: unknown = signal.reason;
  return reason instanceof DOMException && reason.name === 'TimeoutError'
    ? new McpFailure('unreachable', `The server did not answer ${what} in time`)
    : new McpFailure('aborted', 'Stopped: the turn ended');
}
