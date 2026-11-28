import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { PluginMessage, type PluginChannelEvents } from '@morrowbot/contracts';
import { defineProvider, type PluginFactory } from '@morrowbot/plugin-sdk';
import { expect, it, vi } from 'vitest';
import { inHostChannel } from './in-host-channel.ts';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function untilGone(pid: number): Promise<void> {
  for (let tries = 0; tries < 100 && alive(pid); tries += 1) await sleep(50);
}

/** A command whose shell prints the pid of a `sleep` it leaves running in its group. */
function sleeperOptions(onPid: (pid: number) => void) {
  return {
    args: ['-c', 'sleep 60 & echo $!; wait'],
    cwd: tmpdir(),
    files: [],
    scope: { kind: 'probe' } as const,
    signal: new AbortController().signal,
    onLine: (line: string) => {
      onPid(Number(line));
    },
  };
}

/** Opens `factory` in the host, answering every group registration as the host does. */
function connect(factory: PluginFactory) {
  const received: string[] = [];
  const groups: number[] = [];
  const exited = Promise.withResolvers<{ code: number | null; signal: string | null }>();
  const events: PluginChannelEvents = {
    message: (raw) => {
      const message = PluginMessage.parse(raw);
      received.push(message.kind);
      if (message.kind === 'child-group-started') {
        groups.push(message.pgid);
        channel.send({ kind: 'child-group-ack', pgid: message.pgid }, () => undefined);
      }
    },
    exit: (code, signal) => {
      exited.resolve({ code, signal });
    },
    error: (error) => {
      exited.reject(error);
    },
  };
  const channel = inHostChannel(factory, { PATH: process.env.PATH }, process.platform)(events);
  return { channel, received, groups, exited: exited.promise };
}

const unused = (): never => {
  throw new Error('not used here');
};

it('kill ends a built-in provider as SIGKILL ends a worker: its command groups are swept and nothing more arrives', async () => {
  const sleeper = Promise.withResolvers<number>();
  const { channel, received, groups, exited } = connect((runtime) =>
    defineProvider({
      providerInfo: () => {
        runtime.openCommand('sh', sleeperOptions(sleeper.resolve));
        return new Promise(() => undefined);
      },
      usage: unused,
      routeInfo: unused,
      turn: unused,
    }),
  );
  channel.send({ kind: 'provider-info', id: 1, refresh: false }, () => undefined);
  const pid = await sleeper.promise;
  channel.kill();
  const exit = await exited;
  await untilGone(pid);
  await sleep(300);
  expect({ exit, connected: channel.connected, sleeperAlive: alive(pid), groupAlive: alive(-(groups[0] ?? 0)), received }).toMatchInlineSnapshot(`
    {
      "connected": false,
      "exit": {
        "code": null,
        "signal": "SIGKILL",
      },
      "groupAlive": false,
      "received": [
        "child-group-started",
      ],
      "sleeperAlive": false,
    }
  `);
});

it('after a graceful shutdown no command of the provider survives, and none starts again', async () => {
  const sleeper = Promise.withResolvers<number>();
  const late = Promise.withResolvers<string>();
  const shutDown = Promise.withResolvers<undefined>();
  const { channel, received, exited } = connect((runtime) =>
    defineProvider({
      providerInfo: async () => {
        await shutDown.promise;
        const exit = await runtime.runCommand('sh', { ...sleeperOptions(() => undefined), input: '' });
        late.resolve(exit.kind === 'failed' ? exit.message : exit.kind);
        return new Promise(() => undefined);
      },
      usage: unused,
      routeInfo: unused,
      turn: unused,
      shutdown: async () => {
        runtime.openCommand('sh', sleeperOptions(sleeper.resolve));
        await sleeper.promise;
      },
    }),
  );
  channel.send({ kind: 'provider-info', id: 1, refresh: false }, () => undefined);
  channel.send({ kind: 'shutdown', id: 2 }, () => undefined);
  const exit = await exited;
  shutDown.resolve(undefined);
  const pid = await sleeper.promise;
  await untilGone(pid);
  expect({ exit, sleeperAlive: alive(pid), lateCommand: await late.promise, received }).toMatchInlineSnapshot(`
    {
      "exit": {
        "code": 0,
        "signal": null,
      },
      "lateCommand": "The plugin has stopped",
      "received": [
        "child-group-started",
        "shutdown-result",
      ],
      "sleeperAlive": false,
    }
  `);
});

it('runs a built-in provider\'s commands with only its own environment, not the host\'s', async () => {
  vi.stubEnv('MORROWBOT_HOST_ONLY', 'host secret');
  const printed = Promise.withResolvers<string>();
  const { channel } = connect((runtime) =>
    defineProvider({
      providerInfo: async () => {
        let output = '';
        await runtime.runCommand('sh', {
          ...sleeperOptions(() => undefined),
          args: ['-c', 'echo "host=[$MORROWBOT_HOST_ONLY] path=[${PATH:+set}]"'],
          input: '',
          onLine: (line) => {
            output += line;
          },
        });
        printed.resolve(output);
        return new Promise(() => undefined);
      },
      usage: unused,
      routeInfo: unused,
      turn: unused,
    }),
  );
  channel.send({ kind: 'provider-info', id: 1, refresh: false }, () => undefined);
  const output = await printed.promise;
  vi.unstubAllEnvs();
  channel.kill();
  expect(output).toMatchInlineSnapshot(`"host=[] path=[set]"`);
});

it('a turn end that is not JSON ends only that provider, as a crash, and the host carries on', async () => {
  const { channel, received, exited } = connect(() =>
    defineProvider({
      providerInfo: unused,
      usage: unused,
      routeInfo: unused,
      turn: ({ request }) => {
        const end = {
          outcome: { kind: 'completed', finishReason: 'stop' } as const,
          usage: { kind: 'unavailable' } as const,
          actualModel: null,
          accountKey: request.expectedAccountKey,
          sessionTouched: true,
          finalText: null,
          tokens: 1n,
        };
        return Promise.resolve(end);
      },
    }),
  );
  channel.send(
    {
      kind: 'turn',
      turnId: 'turn-1',
      cwd: tmpdir(),
      mode: 'interactive',
      access: 'read-only',
      vendorSettings: 'isolated',
      expectedAccountKey: 'acct',
      expectedRouteKey: '',
      selection: { kind: 'default' },
      session: { kind: 'new', seed: null },
      system: null,
      prompt: 'hi',
      images: [],
    },
    () => undefined,
  );
  expect({ exit: await exited, connected: channel.connected, received }).toMatchInlineSnapshot(`
    {
      "connected": false,
      "exit": {
        "code": 1,
        "signal": null,
      },
      "received": [],
    }
  `);
});

it('a built-in provider that throws while it is built fails to start instead of taking the host down', async () => {
  const failed = Promise.withResolvers<{ message: string; started: boolean }>();
  const open = inHostChannel(
    () => {
      throw new Error('could not build');
    },
    {},
    process.platform,
  );
  const channel = open({
    message: () => undefined,
    exit: () => undefined,
    error: (error, started) => {
      failed.resolve({ message: error.message, started });
    },
  });
  expect({ connected: channel.connected, failure: await failed.promise }).toMatchInlineSnapshot(`
    {
      "connected": false,
      "failure": {
        "message": "could not build",
        "started": false,
      },
    }
  `);
});
