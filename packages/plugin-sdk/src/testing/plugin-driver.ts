import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PluginMessage, type HostMessage } from '@morrowbot/contracts';

const FIXTURE = fileURLToPath(new URL('./command-plugin.ts', import.meta.url));

type Message<K extends PluginMessage['kind']> = Extract<PluginMessage, { kind: K }>;

function isKind<K extends PluginMessage['kind']>(message: PluginMessage, kind: K): message is Message<K> {
  return message.kind === kind;
}

/** The command a fixture turn runs. `{fileN}` in `args` becomes the path of `files[N]`. */
export type TurnSpec =
  | { readonly kind: 'command'; readonly command: string; readonly args: readonly string[]; readonly files: readonly string[] }
  | { readonly kind: 'throw'; readonly message: string }
  /** Asks for one approval and ends with the answer as `finalText`. */
  | { readonly kind: 'ask'; readonly summary: string };

/** The host side of the wire for one `command-plugin.ts` process. */
export interface PluginUnderTest {
  readonly pid: number;
  /** Sends a frame as the host would; not checked, so tests can send malformed ones. */
  send(message: HostMessage | Readonly<Record<string, unknown>>): void;
  /** The next unread message of `kind`, checked against the contract. */
  next<K extends PluginMessage['kind']>(kind: K, timeoutMs?: number): Promise<Message<K>>;
  /** Every message received so far, in order. */
  readonly received: readonly PluginMessage[];
  stderr(): string;
  /** SIGKILLs the plugin process and waits for it to exit. */
  killHard(): Promise<void>;
}

export function startPlugin(options: { readonly kind: 'provider' | 'tool'; readonly env?: NodeJS.ProcessEnv }): PluginUnderTest {
  const child = fork(FIXTURE, [options.kind], {
    env: options.env ?? process.env,
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('The fixture plugin did not start');
  const received: PluginMessage[] = [];
  const unread: PluginMessage[] = [];
  let wake = Promise.withResolvers<undefined>();
  let errorOutput = '';
  const exited = new Promise<undefined>((resolve) => {
    child.once('exit', () => {
      resolve(undefined);
    });
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (text: string) => {
    errorOutput += text;
  });
  child.on('message', (raw: unknown) => {
    const message = PluginMessage.parse(raw);
    received.push(message);
    unread.push(message);
    wake.resolve(undefined);
    wake = Promise.withResolvers<undefined>();
  });
  return {
    pid,
    received,
    send: (message) => child.send(message),
    next: async (kind, timeoutMs = 10_000) => {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        const index = unread.findIndex((message) => isKind(message, kind));
        const found = unread[index];
        if (found !== undefined && isKind(found, kind)) {
          unread.splice(index, 1);
          return found;
        }
        const left = deadline - performance.now();
        if (left <= 0) throw new Error(`No ${kind} message within ${String(timeoutMs)} ms; stderr: ${errorOutput}`);
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([wake.promise, new Promise((resolve) => (timer = setTimeout(resolve, left)))]);
        clearTimeout(timer);
      }
    },
    stderr: () => errorOutput,
    killHard: async () => {
      child.kill('SIGKILL');
      await exited;
    },
  };
}

/** A `turn` frame whose prompt tells the fixture what to run. */
export function turnFrame(turnId: string, cwd: string, spec: TurnSpec): HostMessage {
  return {
    kind: 'turn',
    turnId,
    cwd,
    mode: 'interactive',
    access: 'read-only',
    vendorSettings: 'isolated',
    expectedAccountKey: '',
    expectedRouteKey: '',
    selection: { kind: 'default' },
    session: { kind: 'new', seed: null },
    system: null,
    prompt: JSON.stringify(spec),
    images: [],
    hostTools: { kind: 'none' },
  };
}
