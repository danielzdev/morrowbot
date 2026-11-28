import { fork, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
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

it('says ready, waits for MorrowBot to exit, removes the confirmed files, then opens MorrowBot again', async () => {
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  await fake.file('.morrowbot-dev/desktop/Cookies');
  await fake.file('.morrowbot-dev/workspaces/agent-1/todo.md');
  const main = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)']);
  if (main.pid === undefined) throw new Error('no pid');
  const job: CleanupJob = {
    context: fake.context('isolated', '.morrowbot-dev'),
    approved: [
      { kind: 'delete', path: `${fake.home}/.morrowbot-dev/morrowbot.sqlite` },
      { kind: 'delete', path: `${fake.home}/.morrowbot-dev/desktop` },
    ],
    waitPids: [main.pid],
    relaunch: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(`${fake.home}/relaunched`)}, '')`], cwd: fake.home },
  };
  await fake.file('tmp/.keep');
  const helper = fork(HELPER, [JSON.stringify(job)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, TMPDIR: `${fake.home}/tmp` } });
  const ready = await first(helper, 'message');
  const beforeExit = await fake.tree();
  const code = await first(helper, 'exit');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect({ ready, beforeExit, code, after: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "after": [
        ".morrowbot-dev/workspaces/agent-1/todo.md",
        "relaunched",
        "tmp/.keep",
        "tmp/morrowbot-reset.log",
      ],
      "beforeExit": [
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

it('exits without touching anything when its job is not valid', async () => {
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  const helper = fork(HELPER, [JSON.stringify({ approved: [{ kind: 'delete', path: fake.home }] })], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, TMPDIR: `${fake.home}/none` } });
  const code = await first(helper, 'exit');
  expect({ code, left: await fake.tree() }).toEqual({ code: 2, left: ['.morrowbot-dev/morrowbot.sqlite'] });
});
