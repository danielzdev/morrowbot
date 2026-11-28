import { fork, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CleanupJob } from './cleanup-job.ts';
import { fakeHome, type FakeHome } from './reset-fixture.ts';

const HELPER = fileURLToPath(new URL('./cleanup-helper.ts', import.meta.url));

/** The first argument of the next `event`. */
async function first(emitter: ChildProcess, event: string): Promise<unknown> {
  const args: unknown[] = await once(emitter, event);
  return args[0];
}

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

/** Starts the helper as MorrowBot would, with the fake home as its home and temp folder. */
const start = (job: unknown): ChildProcess =>
  fork(HELPER, [JSON.stringify(job)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, HOME: fake.home, TMPDIR: `${fake.home}/tmp` } });

/** A development-run job deleting the database, waiting on a stand-in for main that exits in 400 ms. */
function devJob(choice: CleanupJob['choice']): CleanupJob {
  const main = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)']);
  if (main.pid === undefined) throw new Error('no pid');
  return { choice, context: fake.context('isolated', '.morrowbot-dev'), approved: [{ kind: 'delete', path: `${fake.home}/.morrowbot-dev/morrowbot.sqlite` }], waitPids: [main.pid] };
}

it('says ready, acts only after commit, waits for MorrowBot to exit, removes the confirmed files, then opens MorrowBot again', async () => {
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  await fake.file('.morrowbot-dev/desktop/Cookies');
  await fake.file('.morrowbot-dev/workspaces/agent-1/todo.md');
  await fake.file('tmp/.keep');
  const relaunch = { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(`${fake.home}/relaunched`)}, '')`], cwd: fake.home };
  const job = devJob({ kind: 'reset', relaunch });
  const helper = start({ ...job, approved: [...job.approved, { kind: 'delete', path: `${fake.home}/.morrowbot-dev/desktop` }] });
  const ready = await first(helper, 'message');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const beforeCommit = await fake.tree();
  helper.send({ kind: 'commit' }, () => {
    helper.disconnect();
  });
  const code = await first(helper, 'exit');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect({ ready, beforeCommit, code, after: await fake.tree() }).toMatchInlineSnapshot(`
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
      "ready": {
        "kind": "ready",
      },
    }
  `);
});

it('does nothing when MorrowBot disconnects without committing, or when the job is malformed, names another home, or would start another program', async () => {
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  await fake.file('tmp/.keep');
  const cancelled = start(devJob({ kind: 'full-uninstall' }));
  await first(cancelled, 'message');
  cancelled.disconnect();
  const outcomes = {
    cancelled: await first(cancelled, 'exit'),
    malformed: await first(start({ approved: [{ kind: 'delete', path: fake.home }] }), 'exit'),
    otherHome: await first(start({ ...devJob({ kind: 'full-uninstall' }), context: { ...fake.context('isolated', '.morrowbot-dev'), homeDir: '/Users/someone-else' } }), 'exit'),
    otherProgram: await first(start(devJob({ kind: 'reset', relaunch: { command: '/bin/sh', args: [], cwd: '/' } })), 'exit'),
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
        "{"kind":"refused","reason":"The job names another home folder."}",
        "{"kind":"refused","reason":"The job would start another program."}",
      ],
      "outcomes": {
        "cancelled": 0,
        "malformed": 2,
        "otherHome": 2,
        "otherProgram": 2,
      },
    }
  `);
});
