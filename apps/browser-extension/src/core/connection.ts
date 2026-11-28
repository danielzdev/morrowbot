import {
  BROWSER_BRIDGE_DEFAULT_PORT,
  BROWSER_BRIDGE_PROTOCOL,
  BROWSER_BRIDGE_SUBPROTOCOL,
  LOOPBACK_TOKEN_PREFIX,
  PluginBridgeMessage,
  type ExtensionMessage,
} from '@morrowbot/contracts';
import type { BrowserDriver } from './driver.ts';
import type { Pairing } from './pairing.ts';

const PING_MS = 20_000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

type Hello = Extract<ExtensionMessage, { kind: 'hello' }>;

export type ConnectionStatus =
  | { readonly kind: 'connecting'; readonly port: number }
  | { readonly kind: 'connected'; readonly port: number; readonly browserId: string }
  | { readonly kind: 'waiting'; readonly port: number; readonly retryInMs: number; readonly reason: string };

/** An open-or-opening WebSocket, wrapped by the caller (a browser's `WebSocket`, or Node's in tests). */
export interface BridgeSocket {
  readonly isOpen: () => boolean;
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface SocketHandlers {
  open(): void;
  message(text: string): void;
  close(code: number, reason: string): void;
}

export interface ConnectionDeps {
  readonly pairing: () => Promise<Pairing>;
  readonly openSocket: (url: string, protocols: string[], handlers: SocketHandlers) => BridgeSocket;
  readonly driver: BrowserDriver;
  readonly browser: Hello['browser'];
  readonly extensionVersion: string;
  readonly onStatus: (status: ConnectionStatus) => void;
}

export interface Connection {
  /** Drops the current socket (if any) and connects again at once, with the latest pairing. */
  reconnect(): void;
  /** True while a socket is open or being opened. */
  readonly active: boolean;
  stop(): void;
}

/** Keeps one bridge connection to the MorrowBot plugin, reconnecting with backoff. */
export function startConnection(deps: ConnectionDeps): Connection {
  let socket: BridgeSocket | null = null;
  let retryMs = RETRY_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let generation = 0;
  let lastPort: number = BROWSER_BRIDGE_DEFAULT_PORT;

  const send = (target: BridgeSocket, message: ExtensionMessage): void => {
    if (target.isOpen()) target.send(JSON.stringify(message));
  };

  deps.driver.onEvent((event) => {
    if (socket !== null) send(socket, { kind: 'event', event });
  });

  const scheduleRetry = (port: number, reason: string): void => {
    if (stopped) return;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    deps.onStatus({ kind: 'waiting', port, retryInMs: wait, reason });
    retryTimer = setTimeout(() => {
      void connect();
    }, wait);
  };

  const connect = async (): Promise<void> => {
    const mine = ++generation;
    clearTimeout(retryTimer);
    let pairing: Pairing;
    try {
      pairing = await deps.pairing();
    } catch (error) {
      if (mine === generation) scheduleRetry(lastPort, `Could not read the pairing: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (stopped || mine !== generation) return;
    const { port, token } = pairing;
    lastPort = port;
    deps.onStatus({ kind: 'connecting', port });
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    const opened: BridgeSocket = deps.openSocket(`ws://127.0.0.1:${String(port)}/`, [BROWSER_BRIDGE_SUBPROTOCOL, `${LOOPBACK_TOKEN_PREFIX}${token}`], {
      open: () => {
        send(opened, { kind: 'hello', protocol: BROWSER_BRIDGE_PROTOCOL, browser: deps.browser, extensionVersion: deps.extensionVersion, commands: [...deps.driver.commands] });
        pingTimer = setInterval(() => {
          send(opened, { kind: 'ping' });
        }, PING_MS);
      },
      message: (text) => {
        const message = parseFrame(text);
        if (message === null) return;
        switch (message.kind) {
          case 'welcome':
            retryMs = RETRY_MIN_MS;
            deps.onStatus({ kind: 'connected', port, browserId: message.browserId });
            return;
          case 'command':
            void deps.driver.run(message.command).then((result) => {
              send(opened, { kind: 'result', id: message.id, result });
            });
            return;
          case 'pong':
            return;
        }
      },
      close: (code, reason) => {
        clearInterval(pingTimer);
        if (socket === opened) socket = null;
        if (mine !== generation) return;
        scheduleRetry(port, code === 1006 ? 'MorrowBot is not running, or the pairing token or port does not match.' : reason || `Closed (${String(code)})`);
      },
    });
    socket = opened;
  };

  void connect();
  return {
    reconnect: () => {
      retryMs = RETRY_MIN_MS;
      const old = socket;
      socket = null;
      generation += 1;
      old?.close(1000, 'Reconnecting');
      void connect();
    },
    get active() {
      return socket !== null;
    },
    stop: () => {
      stopped = true;
      generation += 1;
      clearTimeout(retryTimer);
      socket?.close(1000, 'Stopped');
      socket = null;
    },
  };
}

function parseFrame(text: string): PluginBridgeMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = PluginBridgeMessage.safeParse(json);
  if (!parsed.success) {
    console.warn(`MorrowBot: ignored a malformed frame from the plugin: ${parsed.error.message}`);
    return null;
  }
  return parsed.data;
}
