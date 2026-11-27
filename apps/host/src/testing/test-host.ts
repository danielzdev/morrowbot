import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatProvider } from '@morrowbot/contracts';
import { ChatEvent } from '@morrowbot/contracts';
import { pluginProviders } from '../features/chat/index.ts';
import { startHost, type Host } from '../host.ts';

/** The plugin host's own fixture plugins (`echo` is a provider that can stall). */
export const PLUGIN_FIXTURES = fileURLToPath(new URL('../features/plugins/fixtures', import.meta.url));

export interface Sequence {
  readonly newId: () => string;
  readonly now: () => string;
}

/** Deterministic ids and timestamps. Pass the same sequence to a restarted host so ids never repeat. */
export function sequence(): Sequence {
  let id = 0;
  let tick = 0;
  return {
    newId: () => `id-${String(++id)}`,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  };
}

export interface TestHostOptions {
  readonly dataDir: string;
  /** Stub providers by plugin id, or 'plugins' to chat through the real plugin host. Defaults to none. */
  readonly providers?: Readonly<Record<string, ChatProvider>> | 'plugins';
  /** Defaults to an empty folder in `dataDir`. */
  readonly pluginsDir?: string;
  readonly sequence?: Sequence;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export interface TestHost {
  readonly host: Host;
  readonly url: string;
  readonly errors: unknown[];
  call(method: string, path: string, body?: unknown): Promise<Reply>;
  events(): Promise<EventLog>;
  close(): Promise<void>;
}

export async function startTestHost(options: TestHostOptions): Promise<TestHost> {
  const providers = options.providers ?? {};
  const errors: unknown[] = [];
  const sockets: WebSocket[] = [];
  const host = await startHost({
    config: {
      hostname: '127.0.0.1',
      port: 0,
      safeMode: false,
      dataDir: options.dataDir,
      pluginsDir: options.pluginsDir ?? path.join(options.dataDir, 'plugins'),
    },
    version: '0.0.0-test',
    providers: (plugins) =>
      providers === 'plugins' ? pluginProviders(plugins) : { provider: (pluginId) => providers[pluginId] },
    onPluginStatus: () => undefined,
    ...(options.sequence ?? sequence()),
    report: (error) => errors.push(error),
  });
  return {
    host,
    url: host.url,
    errors,
    call: async (method, path, body) => {
      const response = await fetch(`${host.url}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      const parsed: unknown = text === '' ? null : JSON.parse(text);
      return { status: response.status, body: parsed };
    },
    events: async () => {
      const socket = new WebSocket(`${host.url.replace('http:', 'ws:')}/api/events`);
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      return new EventLog(socket);
    },
    close: async () => {
      for (const socket of sockets) socket.close();
      await host.close();
    },
  };
}

/** Every event received on one `/api/events` socket, parsed with the contract. */
export class EventLog {
  readonly received: ChatEvent[] = [];
  private readonly waiters: { readonly match: (event: ChatEvent) => boolean; readonly resolve: () => void }[] = [];

  constructor(socket: WebSocket) {
    socket.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') throw new Error('Expected a text frame');
      const event = ChatEvent.parse(JSON.parse(message.data));
      this.received.push(event);
      for (const waiter of this.waiters.filter((candidate) => candidate.match(event))) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    });
  }

  /** Resolves once an event matching `match` has arrived (including ones already received). */
  until(match: (event: ChatEvent) => boolean): Promise<void> {
    if (this.received.some(match)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  finished(threadId: string): Promise<void> {
    return this.until((event) => event.kind === 'generation.finished' && event.threadId === threadId);
  }
}
