import { fork, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CleanupJob } from './cleanup-job.ts';
import { fakeHome, type FakeHome } from './reset-fixture.ts';

const HELPER = fileURLToPath(new URL('./cleanup-helper.ts', import.meta.url));

/** The next message from the helper, or how it exited if it exits first, so a refusal never hangs a test. */
function next(child: ChildProcess): Promise<unknown> {
  return new Promise((resolve) => {
    const onMessage = (message: unknown): void => {
      child.off('exit', onExit);
      resolve(message);
    };
    const onExit = (code: number | null): void => {
      child.off('message', onMessage);
      resolve({ exited: code });
    };
    child.once('message', onMessage);
    child.once('exit', onExit);
  });
}

/** How the helper exits. */
async function exitOf(child: ChildProcess): Promise<unknown> {
  if (child.exitCode !== null) return child.exitCode;
  const args: unknown[] = await once(child, 'exit');
  return args[0];
}

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

/** Starts the helper as MorrowBot would, with the fake home as its home and temp folder, and hands it the job over IPC. */
function start(job: unknown): ChildProcess {
  const child = fork(HELPER, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, HOME: fake.home, TMPDIR: `${fake.home}/tmp` } });
  child.send({ kind: 'job', job });
  return child;
}

/** A development-run job on this platform deleting the database, waiting on a stand-in for main that exits in 400 ms. */
function devJob(choice: CleanupJob['choice']): CleanupJob {
  const main = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)']);
  if (main.pid === undefined) throw new Error('no pid');
  return { choice, context: { ...fake.context('isolated', '.morrowbot-dev'), platform: process.platform }, approved: [{ kind: 'delete', path: `${fake.home}/.morrowbot-dev/morrowbot.sqlite` }], waitPids: [main.pid] };
}

it.skipIf(process.platform !== 'darwin')('says ready, acts only after commit, confirms it, waits for MorrowBot to exit, removes the confirmed files, then opens MorrowBot again', async () => {
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  await fake.file('.morrowbot-dev/desktop/Cookies');
  await fake.file('.morrowbot-dev/workspaces/agent-1/todo.md');
  await fake.file('tmp/.keep');
  const relaunch = { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(`${fake.home}/relaunched`)}, '')`], cwd: fake.home };
  const job = devJob({ kind: 'reset', relaunch });
  const helper = start({ ...job, approved: [...job.approved, { kind: 'delete', path: `${fake.home}/.morrowbot-dev/desktop` }] });
  const ready = await next(helper);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const beforeCommit = await fake.tree();
  helper.send({ kind: 'commit' });
  const committed = await next(helper);
  if (helper.connected) helper.disconnect();
  const code = await exitOf(helper);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect({ ready, beforeCommit, committed, code, after: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "after": [
        ".morrowbot-dev/workspaces/agent-1/todo.md",
        "relaunched",
        "tmp/.keep",
        "tmp/morrowbot-reset.log",
      ],
      "beforeCommit": [
        ".morrowbot-dev/desktop/Cookies",
        ".morrowbot-dev/morrowbot.sqlite",
        ".morrowbot-dev/workspaces/agent-1/todo.md",
        "tmp/.keep",
      ],
      "code": 0,
      "committed": {
        "kind": "committed",
      },
      "ready": {
        "kind": "ready",
      },
    }
  `);
});

it('does nothing when MorrowBot disconnects without committing, or when the job is malformed, names another platform or home, or would start another program', async () => {
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  await fake.file('tmp/.keep');
  const cancelled = start(devJob({ kind: 'full-uninstall' }));
  const ready = await next(cancelled);
  cancelled.disconnect();
  const outcomes = {
    ready,
    cancelled: await exitOf(cancelled),
    malformed: await next(start({ approved: [{ kind: 'delete', path: fake.home }] })),
    otherPlatform: await next(start({ ...devJob({ kind: 'full-uninstall' }), context: { ...fake.context('isolated', '.morrowbot-dev'), platform: process.platform === 'win32' ? 'linux' : 'win32' } })),
    otherHome: await next(start({ ...devJob({ kind: 'full-uninstall' }), context: { ...fake.context('isolated', '.morrowbot-dev'), platform: process.platform, homeDir: '/Users/someone-else' } })),
    otherProgram: await next(start(devJob({ kind: 'reset', relaunch: { command: '/bin/sh', args: [], cwd: '/' } }))),
  };
  await new Promise((resolve) => setTimeout(resolve, 600));
  const log = (await readFile(`${fake.home}/tmp/morrowbot-reset.log`, 'utf8')).trim().split('\n').map((line) => line.slice(line.indexOf(' ') + 1));
  expect({ outcomes, left: await fake.tree(), log }).toMatchInlineSnapshot(`
    {
      "left": [
        ".morrowbot-dev/morrowbot.sqlite",
        "tmp/.keep",
        "tmp/morrowbot-reset.log",
      ],
      "log": [
        "{"kind":"cancelled"}",
        "{"kind":"bad-job"}",
        "{"kind":"refused","reason":"The job names another platform."}",
        "{"kind":"refused","reason":"The job names another home folder."}",
        "{"kind":"refused","reason":"The job would start another program."}",
      ],
      "outcomes": {
        "cancelled": 0,
        "malformed": {
          "exited": 2,
        },
        "otherHome": {
          "exited": 2,
        },
        "otherPlatform": {
          "exited": 2,
        },
        "otherProgram": {
          "exited": 2,
        },
        "ready": {
          "kind": "ready",
        },
      },
    }
  `);
});
