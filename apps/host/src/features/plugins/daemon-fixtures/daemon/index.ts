import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { defineProvider, openCommand, runPlugin, z, type AccessProfile, type OpenCommand, type ProviderInfo, type TurnEnd } from '@morrowbot/plugin-sdk';

/**
 * A test provider backed by one shared daemon (`fake-daemon.ts`), started from provider-info as a
 * `daemon` process group and kept across turns. Files in its data folder steer it: `pause-info`,
 * `pause-route` and `pause-usage` hold those requests until removed, `hang-info` makes provider-info
 * never answer, `signed-out` reports signed-out, `sessions` reports session support. A route-info
 * whose daemon was replaced while it was held fails. It writes its pid to `worker.pid`. Everything it does is appended to `events.jsonl`; daemons are named d1, d2, … in start order.
 */
const DAEMON_SCRIPT = fileURLToPath(new URL('./fake-daemon.ts', import.meta.url));
const PROFILE: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false };
const Reply = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), id: z.number(), text: z.string() }),
  z.strictObject({ kind: z.literal('done'), id: z.number(), result: z.string() }),
]);

interface Call {
  readonly onText: (text: string) => void;
  readonly done: PromiseWithResolvers<string>;
}

interface Daemon {
  readonly name: string;
  readonly command: OpenCommand;
  readonly calls: Map<number, Call>;
}

let dataDir = '';
let daemon: Daemon | undefined;
let starting: Promise<Daemon> | undefined;
let nextCall = 0;

const file = (name: string): string => path.join(dataDir, name);

function record(event: Readonly<Record<string, unknown>>): void {
  appendFileSync(file('events.jsonl'), `${JSON.stringify(event)}\n`);
}

function daemonsStarted(): number {
  if (!existsSync(file('events.jsonl'))) return 0;
  return readFileSync(file('events.jsonl'), 'utf8').split('\n').filter((line) => line.includes('"daemon-start"')).length;
}

function call(target: Daemon, request: Readonly<Record<string, unknown>>, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const id = nextCall++;
  const done = Promise.withResolvers<string>();
  target.calls.set(id, { onText, done });
  target.command.write(`${JSON.stringify({ id, ...request })}\n`);
  signal?.addEventListener('abort', () => { target.command.write(`${JSON.stringify({ id, method: 'interrupt' })}\n`); }, { once: true });
  return done.promise;
}

async function startDaemon(): Promise<Daemon> {
  const name = `d${String(daemonsStarted() + 1)}`;
  const calls = new Map<number, Call>();
  const command = openCommand(process.execPath, {
    args: [DAEMON_SCRIPT, name],
    cwd: dataDir,
    files: [],
    scope: { kind: 'daemon' },
    signal: new AbortController().signal,
    onLine: (line) => {
      const reply = Reply.parse(JSON.parse(line));
      const pending = calls.get(reply.id);
      if (pending === undefined) return;
      if (reply.kind === 'text') {
        pending.onText(reply.text);
        return;
      }
      calls.delete(reply.id);
      pending.done.resolve(reply.result);
    },
  });
  const started: Daemon = { name, command, calls };
  record({ event: 'daemon-start', daemon: name });
  void command.exited.then(() => {
    record({ event: 'daemon-exit', daemon: name });
    if (daemon === started) daemon = undefined;
    for (const pending of calls.values()) pending.done.reject(new Error(`${name} exited`));
    calls.clear();
  });
  await call(started, { method: 'hello' }, () => undefined);
  return started;
}

async function held(flag: string): Promise<void> {
  while (existsSync(file(flag))) await sleep(20);
}

function ready(name: string): ProviderInfo {
  return {
    kind: 'ready',
    version: '1.0.0',
    accountKey: 'acct-d',
    accountLabel: name,
    models: [{ id: 'tiny', label: 'Tiny', isDefault: true, options: [] }],
    capabilities: { profiles: [PROFILE], approvals: false, sessions: existsSync(file('sessions')), usage: 'live', withheld: [] },
    warning: null,
  };
}

function end(outcome: TurnEnd['outcome']): TurnEnd {
  return { outcome, usage: { kind: 'unavailable' }, actualModel: null, accountKey: 'acct-d', sessionTouched: true, finalText: null };
}

runPlugin(
  defineProvider({
    init: (context) => {
      dataDir = context.dataDir;
      writeFileSync(file('worker.pid'), String(process.pid));
    },
    providerInfo: async ({ refresh }) => {
      if (daemon === undefined) {
        starting ??= startDaemon().finally(() => {
          starting = undefined;
        });
        daemon = await starting;
      }
      const { name } = daemon;
      record({ event: 'info', refresh, daemon: name });
      await held('pause-info');
      if (existsSync(file('hang-info'))) return new Promise<ProviderInfo>(() => undefined);
      if (existsSync(file('signed-out'))) return { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: ['daemon', 'login'] } };
      return ready(name);
    },
    usage: async () => {
      record({ event: 'usage', daemon: daemon?.name ?? null });
      await held('pause-usage');
      return { kind: 'unavailable', observedAt: '2026-01-01T00:00:00.000Z', accountKey: 'acct-d', reason: 'not-yet-observed' };
    },
    routeInfo: async () => {
      const target = daemon;
      record({ event: 'route', daemon: target?.name ?? null });
      await held('pause-route');
      if (target === undefined || daemon !== target) return { kind: 'failed', reason: 'the daemon went away' };
      return { kind: 'known', accountKey: 'acct-d', routeKey: '' };
    },
    turn: async ({ request, signal, emit }) => {
      const target = daemon;
      if (target === undefined) return { ...end({ kind: 'failed', error: { kind: 'other', message: 'no daemon' } }), sessionTouched: false };
      record({ event: 'turn', daemon: target.name, prompt: request.prompt });
      const result = await call(target, { method: 'turn', prompt: request.prompt }, (text) => { emit({ kind: 'text', text }); }, signal);
      return end(result === 'cancelled' ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' });
    },
  }),
);
