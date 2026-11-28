import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startPlugin, turnFrame, type PluginUnderTest, type TurnSpec } from './testing/plugin-driver.ts';
import { liveness, readLineWhenWritten, waitUntilGone } from './testing/processes.ts';

/** These tests play the host: they start a real plugin process and drive it over its IPC channel. */
let base: string;
let work: string;
let temp: string;
const plugins: PluginUnderTest[] = [];

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-sdk-')));
  work = path.join(base, 'work');
  temp = path.join(base, 'tmp');
  await mkdir(work);
  await mkdir(temp);
});
afterEach(async () => {
  await Promise.all(plugins.splice(0).map((plugin) => plugin.killHard()));
  await rm(base, { recursive: true, force: true });
});

function start(): PluginUnderTest {
  const plugin = startPlugin({ kind: 'provider', env: { ...process.env, TMPDIR: temp } });
  plugins.push(plugin);
  return plugin;
}

/** A CLI that records its pid and a background grandchild's pid in `pids`, then waits. */
const RECORD_PIDS: TurnSpec = { kind: 'command', command: '/bin/sh', args: ['-c', 'sleep 30 & echo $$ $! > pids; wait'], files: [] };

async function recordedPids(): Promise<{ cli: number; grandchild: number }> {
  const [cli = 0, grandchild = 0] = (await readLineWhenWritten(path.join(work, 'pids'))).split(' ').map(Number);
  return { cli, grandchild };
}

it('kills the CLI and everything it started when the plugin process is SIGKILLed', async () => {
  const plugin = start();
  plugin.send(turnFrame('turn-1', work, RECORD_PIDS));
  const started = await plugin.next('child-group-started');
  plugin.send({ kind: 'child-group-ack', pgid: started.pgid });
  const { cli, grandchild } = await recordedPids();
  const pids = { guard: started.pgid, group: -started.pgid, cli, grandchild };
  const before = await waitUntilGone(pids, 0);
  await plugin.killHard();
  expect({ scope: started.scope, before, after: await waitUntilGone(pids) }).toMatchInlineSnapshot(`
    {
      "after": {
        "cli": "gone",
        "grandchild": "gone",
        "group": "gone",
        "guard": "gone",
      },
      "before": {
        "cli": "alive",
        "grandchild": "alive",
        "group": "alive",
        "guard": "alive",
      },
      "scope": {
        "kind": "turn",
        "turnId": "turn-1",
      },
    }
  `);
});

it('never starts the CLI before the host acknowledges the group, and the group dies with the plugin', async () => {
  const plugin = start();
  plugin.send(turnFrame('turn-2', work, { kind: 'command', command: '/bin/sh', args: ['-c', 'echo ran > ran; sleep 30'], files: [] }));
  const started = await plugin.next('child-group-started');
  await sleep(300);
  const waiting = { group: liveness(-started.pgid), cliRan: existsSync(path.join(work, 'ran')) };
  await plugin.killHard();
  const after = await waitUntilGone({ guard: started.pgid, group: -started.pgid });
  expect({ waiting, after, cliRan: existsSync(path.join(work, 'ran')) }).toMatchInlineSnapshot(`
    {
      "after": {
        "group": "gone",
        "guard": "gone",
      },
      "cliRan": false,
      "waiting": {
        "cliRan": false,
        "group": "alive",
      },
    }
  `);
});

/** A CLI that copies its input file into `received` and then waits. */
const READ_FILE: TurnSpec = {
  kind: 'command',
  command: '/bin/sh',
  args: ['-c', 'cat "$1" > received; echo >> received; sleep 30', 'sh', '{file0}'],
  files: ['secret contents'],
};

it('leaves no input file on disk while a turn runs or after it is cancelled', async () => {
  const plugin = start();
  plugin.send(turnFrame('turn-3', work, READ_FILE));
  const started = await plugin.next('child-group-started');
  plugin.send({ kind: 'child-group-ack', pgid: started.pgid });
  const received = await readLineWhenWritten(path.join(work, 'received'));
  const whileRunning = await readdir(temp);
  plugin.send({ kind: 'cancel', turnId: 'turn-3' });
  const end = await plugin.next('turn-end');
  const exited = await plugin.next('child-group-exited');
  expect({
    received,
    whileRunning,
    outcome: end.outcome,
    exit: end.finalText,
    exitedGroup: exited.pgid === started.pgid,
    afterCancel: await readdir(temp),
  }).toMatchInlineSnapshot(`
    {
      "afterCancel": [],
      "exit": "{"kind":"exited","code":null,"signal":"SIGTERM","stderr":""}",
      "exitedGroup": true,
      "outcome": {
        "kind": "cancelled",
      },
      "received": "secret contents",
      "whileRunning": [],
    }
  `);
});

it('leaves no input file on disk after the plugin process is SIGKILLed', async () => {
  const plugin = start();
  plugin.send(turnFrame('turn-4', work, READ_FILE));
  const started = await plugin.next('child-group-started');
  plugin.send({ kind: 'child-group-ack', pgid: started.pgid });
  const received = await readLineWhenWritten(path.join(work, 'received'));
  await plugin.killHard();
  const after = await waitUntilGone({ group: -started.pgid });
  expect({ received, after, temp: await readdir(temp) }).toMatchInlineSnapshot(`
    {
      "after": {
        "group": "gone",
      },
      "received": "secret contents",
      "temp": [],
    }
  `);
});

it('stops the group when the host sends kill-child-group', async () => {
  const plugin = start();
  plugin.send(turnFrame('turn-5', work, RECORD_PIDS));
  const started = await plugin.next('child-group-started');
  plugin.send({ kind: 'child-group-ack', pgid: started.pgid });
  const { cli, grandchild } = await recordedPids();
  plugin.send({ kind: 'kill-child-group', pgid: started.pgid });
  const end = await plugin.next('turn-end');
  const after = await waitUntilGone({ group: -started.pgid, cli, grandchild });
  expect({ outcome: end.outcome, exit: end.finalText, after }).toMatchInlineSnapshot(`
    {
      "after": {
        "cli": "gone",
        "grandchild": "gone",
        "group": "gone",
      },
      "exit": "{"kind":"exited","code":null,"signal":"SIGTERM","stderr":""}",
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
    }
  `);
});
