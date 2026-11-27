import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventServerFrame, ThreadState, type AgentMessage, type ChatEvent, type Cursor } from '@morrowbot/contracts';
import WebSocket, { type RawData } from 'ws';
import type { ChildGroupClock, PluginTimeouts, ProcessProbe } from '../features/plugins/index.ts';
import { startHost, type Host } from '../host.ts';

export { DEFAULT_PLUGIN_TIMEOUTS } from '../features/plugins/index.ts';
export type { PluginTimeouts } from '../features/plugins/index.ts';

/** The plugin host's own fixture plugins (`echo` is a provider with scripted prompts). */
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
  /** Defaults to an empty folder in `dataDir`. */
  readonly pluginsDir?: string;
  readonly sequence?: Sequence;
  readonly timeouts?: PluginTimeouts;
  readonly probe?: ProcessProbe;
  readonly clock?: ChildGroupClock;
  /** The OS the built-in providers act on. Defaults to this one. */
  readonly platform?: NodeJS.Platform;
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
  /** A new `/api/events` socket. */
  events(): Promise<EventClient>;
  close(): Promise<void>;
}

export async function startTestHost(options: TestHostOptions): Promise<TestHost> {
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
    hostName: 'Studio Host',
    onPluginStatus: () => undefined,
    ...(options.sequence ?? sequence()),
    report: (error) => errors.push(error),
    pluginPath: process.env.PATH ?? '/usr/bin:/bin',
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  });
  const call = async (method: string, route: string, body?: unknown): Promise<Reply> => {
    const headers: Record<string, string> = { authorization: `Bearer ${host.token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${host.url}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);
    return { status: response.status, body: parsed };
  };
  return {
    host,
    url: host.url,
    errors,
    call,
    events: async () => {
      const socket = new WebSocket(`${host.url.replace('http:', 'ws:')}/api/events`, { headers: { authorization: `Bearer ${host.token}` } });
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      return new EventClient(socket, call);
    },
    close: async () => {
      for (const socket of sockets) socket.close();
      await host.close();
    },
  };
}

/** Every frame received on one `/api/events` socket, parsed with the contract. */
export class EventClient {
  readonly received: ChatEvent[] = [];
  readonly resyncs: string[] = [];
  /** Agent messages announced on the socket. */
  readonly posted: AgentMessage[] = [];
  private readonly waiters: { readonly match: (event: ChatEvent) => boolean; readonly resolve: () => void }[] = [];
  private readonly socket: WebSocket;
  private readonly call: (method: string, path: string) => Promise<Reply>;

  constructor(socket: WebSocket, call: (method: string, path: string) => Promise<Reply>) {
    this.socket = socket;
    this.call = call;
    socket.on('message', (data) => {
      const frame = EventServerFrame.parse(JSON.parse(textOf(data)));
      if (frame.kind === 'resync') {
        this.resyncs.push(frame.threadId);
        return;
      }
      if (frame.kind === 'agent-message.posted') {
        this.posted.push(frame.message);
        return;
      }
      this.received.push(frame);
      for (const waiter of this.waiters.filter((candidate) => candidate.match(frame))) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    });
  }

  /** Subscribes to a thread from `since` (null: from now on). */
  subscribe(threadId: string, since: Cursor | null): void {
    this.socket.send(JSON.stringify({ kind: 'subscribe', threadId, since }));
  }

  /** Subscribes at the thread's current `/state` cursor, so no event after it can be missed. */
  async watch(threadId: string): Promise<ThreadState> {
    const state = ThreadState.parse((await this.call('GET', `/api/threads/${threadId}/state`)).body);
    this.subscribe(threadId, state.cursor);
    return state;
  }

  /** Resolves once an event matching `match` has arrived (including ones already received). */
  until(match: (event: ChatEvent) => boolean): Promise<void> {
    if (this.received.some(match)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  finished(generationId: string): Promise<void> {
    return this.until((event) => event.kind === 'generation.finished' && event.generationId === generationId);
  }

  /** The thread events of one generation, without cursors. */
  of(generationId: string): unknown[] {
    return this.received
      .filter((event) => event.kind !== 'usage.updated' && event.generationId === generationId)
      .map((event) => {
        if (event.kind === 'usage.updated') return event;
        return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'cursor'));
      });
  }
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
