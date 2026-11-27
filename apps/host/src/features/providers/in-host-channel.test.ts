import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { PluginMessage, type PluginChannelEvents } from '@morrowbot/contracts';
import { defineProvider, type PluginFactory } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
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

const unused = (): never => {
  throw new Error('not used here');
};

it('kill ends a built-in provider as SIGKILL ends a worker: its command groups are swept and nothing more arrives', async () => {
  const sleeper = Promise.withResolvers<number>();
  const factory: PluginFactory = (runtime) =>
    defineProvider({
      providerInfo: () => {
        runtime.openCommand('sh', {
          args: ['-c', 'sleep 60 & echo $!; wait'],
          cwd: tmpdir(),
          files: [],
          scope: { kind: 'probe' },
          signal: new AbortController().signal,
          onLine: (line) => {
            sleeper.resolve(Number(line));
          },
        });
        return new Promise(() => undefined);
      },
      usage: unused,
      routeInfo: unused,
      turn: unused,
    });
  const received: string[] = [];
  const exited = Promise.withResolvers<{ code: number | null; signal: string | null }>();
  const events: PluginChannelEvents = {
    message: (raw) => {
      const message = PluginMessage.parse(raw);
      received.push(message.kind);
      if (message.kind === 'child-group-started') {
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
  channel.send({ kind: 'provider-info', id: 1, refresh: false }, () => undefined);
  const pid = await sleeper.promise;
  channel.kill();
  const exit = await exited.promise;
  await untilGone(pid);
  await sleep(300);
  expect({ exit, connected: channel.connected, sleeperAlive: alive(pid), received }).toMatchInlineSnapshot(`
    {
      "connected": false,
      "exit": {
        "code": null,
        "signal": "SIGKILL",
      },
      "received": [
        "child-group-started",
      ],
      "sleeperAlive": false,
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
