import {
  BROWSER_BRIDGE_PROTOCOL,
  ExtensionMessage,
  type BrowserCommand,
  type BrowserCommandKind,
  type BrowserEvent,
  type BrowserResult,
  type PluginBridgeMessage,
} from '@morrowbot/contracts';
import type { LoopbackSocket } from '@morrowbot/plugin-sdk';

type Hello = Extract<ExtensionMessage, { kind: 'hello' }>;

/** One connected browser, after its `hello`. */
export interface BrowserLink {
  readonly browserId: string;
  readonly browser: Hello['browser'];
  readonly extensionVersion: string;
  /** Sends a command and waits for its result; a timeout or disconnect comes back as an error result. */
  run(command: BrowserCommand, timeoutMs: number): Promise<BrowserResult>;
  /** Hears the browser's events; returns the unsubscribe. */
  onEvent(listener: (event: BrowserEvent) => void): () => void;
  /** Settles when the browser disconnects. */
  readonly gone: Promise<void>;
  close(code: number, reason: string): void;
}

export interface LinkOptions {
  /** Picks the id for a newly greeted browser. */
  readonly nameFor: (hello: Hello) => string;
  readonly helloTimeoutMs: number;
  readonly onReady: (link: BrowserLink) => void;
  readonly onGone: (link: BrowserLink) => void;
}

interface Pending {
  readonly resolve: (result: BrowserResult) => void;
  readonly timer: NodeJS.Timeout;
}

/** Speaks the browser bridge on one authenticated socket. */
export function acceptLink(socket: LoopbackSocket, options: LinkOptions): void {
  let link: BrowserLink | null = null;
  let supported = new Set<BrowserCommandKind>();
  let nextId = 0;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(event: BrowserEvent) => void>();
  const gone = Promise.withResolvers<undefined>();
  const send = (message: PluginBridgeMessage): void => {
    socket.send(JSON.stringify(message));
  };
  const helloTimer = setTimeout(() => {
    socket.close(4000, 'Send hello first');
  }, options.helloTimeoutMs);

  const settle = (id: number, result: BrowserResult): void => {
    const waiting = pending.get(id);
    if (waiting === undefined) return;
    pending.delete(id);
    clearTimeout(waiting.timer);
    waiting.resolve(result);
  };

  const greet = (hello: Hello): void => {
    clearTimeout(helloTimer);
    supported = new Set(hello.commands);
    const browserId = options.nameFor(hello);
    link = {
      browserId,
      browser: hello.browser,
      extensionVersion: hello.extensionVersion,
      run: (command, timeoutMs) => {
        if (!supported.has(command.kind)) {
          return Promise.resolve({ kind: 'error', code: 'unsupported', message: `${hello.browser.name} does not support ${command.kind}.` });
        }
        const id = nextId++;
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            settle(id, { kind: 'error', code: 'timeout', message: `${hello.browser.name} did not answer ${command.kind} within ${String(timeoutMs / 1000)} s.` });
          }, timeoutMs);
          pending.set(id, { resolve, timer });
          send({ kind: 'command', id, command });
        });
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      gone: gone.promise.then(() => undefined),
      close: (code, reason) => {
        socket.close(code, reason);
      },
    };
    send({ kind: 'welcome', protocol: BROWSER_BRIDGE_PROTOCOL, browserId });
    options.onReady(link);
  };

  socket.onMessage((text) => {
    const parsed = parseFrame(text);
    if (parsed.kind === 'invalid') {
      socket.close(4002, parsed.problem.slice(0, 120));
      return;
    }
    const message = parsed.message;
    switch (message.kind) {
      case 'hello':
        if (link === null) greet(message);
        else socket.close(4002, 'hello was already sent');
        return;
      case 'ping':
        send({ kind: 'pong' });
        return;
      case 'result':
        settle(message.id, message.result);
        return;
      case 'event':
        for (const listener of listeners) listener(message.event);
        return;
    }
  });

  socket.onClose(() => {
    clearTimeout(helloTimer);
    for (const id of [...pending.keys()]) settle(id, { kind: 'error', code: 'failed', message: 'The browser disconnected.' });
    gone.resolve(undefined);
    if (link !== null) options.onGone(link);
  });
}

type Frame = { readonly kind: 'message'; readonly message: ExtensionMessage } | { readonly kind: 'invalid'; readonly problem: string };

function parseFrame(text: string): Frame {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'invalid', problem: 'Frames must be JSON' };
  }
  const parsed = ExtensionMessage.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: 'invalid', problem: `Bad frame: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}` };
  }
  return { kind: 'message', message: parsed.data };
}
