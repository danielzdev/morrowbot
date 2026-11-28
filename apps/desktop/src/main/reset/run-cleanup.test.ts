import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CleanupJob } from './cleanup-job.ts';
import { fakeHome, fakeKeychain, type FakeHome } from './reset-fixture.ts';
import { dataPlanOf } from './reset-plan.ts';
import { runCleanup, type CleanupDeps } from './run-cleanup.ts';

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

const exited = (keychain = fakeKeychain([])): CleanupDeps => ({ keychain, isAlive: () => false, sleep: () => Promise.resolve() });

/** The steps the user would confirm for `context` right now. */
async function confirmed(context: CleanupJob['context'], keychain = fakeKeychain([])): Promise<CleanupJob> {
  const plan = await dataPlanOf(context, keychain);
  if (plan.kind === 'refused') throw new Error(plan.reason);
  return { context, approved: plan.steps, waitPids: [4242], relaunch: null };
}

it('removes exactly the confirmed MorrowBot files and Keychain items, and leaves workspaces, links, their targets and unknown files', async () => {
  await fake.file('.morrowbot/morrowbot.sqlite');
  await fake.file('.morrowbot/attachments/a.png');
  await fake.file('.morrowbot/workspaces/agent-1/todo.md');
  await fake.file('.morrowbot/mine.txt');
  await fake.file('my-skills/skill.md');
  await fake.link('.morrowbot/skills', `${fake.home}/my-skills`);
  await fake.file('.morrowbot/plugin-data/echo/link-target-outside.txt');
  await fake.link('.morrowbot/plugin-data/echo/outside', `${fake.home}/Documents`);
  await fake.file('Documents/report.txt');
  await fake.file('Library/Application Support/MorrowBot/Cookies');
  await fake.file('Library/Application Support/Other/keep.db');
  const keychain = fakeKeychain(['com.legendarykoi.morrowbot.releases', 'MorrowBot Safe Storage', 'Other Safe Storage']);
  const job = await confirmed(fake.context('installed', '.morrowbot'), keychain);
  const report = await runCleanup(job, exited(keychain));
  expect({ report: fake.short(report), left: await fake.tree(), keychain: [...keychain.items] }).toMatchInlineSnapshot(`
    {
      "keychain": [
        "Other Safe Storage",
      ],
      "left": [
        ".morrowbot/mine.txt",
        ".morrowbot/skills (link)",
        ".morrowbot/workspaces/agent-1/todo.md",
        "Documents/report.txt",
        "Library/Application Support/Other/keep.db",
        "my-skills/skill.md",
      ],
      "report": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.morrowbot/morrowbot.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/attachments",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/plugin-data",
          },
          {
            "kind": "delete",
            "path": "~/Library/Application Support/MorrowBot",
          },
          {
            "kind": "keychain",
            "service": "com.legendarykoi.morrowbot.releases",
          },
          {
            "kind": "keychain",
            "service": "MorrowBot Safe Storage",
          },
        ],
        "failed": [],
        "kind": "done",
        "skipped": [],
      },
    }
  `);
});

it('skips a confirmed path that became a link since, any Trash step, and any step the fresh plan does not hold', async () => {
  await fake.file('.morrowbot-dev/attachments/a.png');
  await fake.file('.morrowbot-dev/plugins/p/index.js');
  await fake.file('precious/keep.txt');
  const job = await confirmed(fake.context('isolated', '.morrowbot-dev'));
  await rm(`${fake.home}/.morrowbot-dev/plugins`, { recursive: true });
  await fake.link('.morrowbot-dev/plugins', `${fake.home}/precious`);
  const forged: CleanupJob = {
    ...job,
    approved: [...job.approved, { kind: 'trash', path: '/Applications/MorrowBot.app' }, { kind: 'delete', path: `${fake.home}/precious` }, { kind: 'delete', path: fake.home }],
  };
  const report = await runCleanup(forged, exited());
  expect({ report: fake.short(report), left: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "left": [
        ".morrowbot-dev/plugins (link)",
        "precious/keep.txt",
      ],
      "report": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.morrowbot-dev/attachments",
          },
        ],
        "failed": [],
        "kind": "done",
        "skipped": [
          {
            "kind": "delete",
            "path": "~/.morrowbot-dev/plugins",
          },
          {
            "kind": "trash",
            "path": "/Applications/MorrowBot.app",
          },
          {
            "kind": "delete",
            "path": "~/precious",
          },
          {
            "kind": "delete",
            "path": "~",
          },
        ],
      },
    }
  `);
});

it('touches nothing while MorrowBot is still running, or when the job aims at the installed data from a development run', async () => {
  await fake.file('.morrowbot/morrowbot.sqlite');
  const job = await confirmed(fake.context('installed', '.morrowbot'));
  const stillRunning = await runCleanup(job, { ...exited(), isAlive: (pid) => pid === 4242 });
  const devAtInstalled = await runCleanup({ ...job, context: fake.context('isolated', '.morrowbot') }, exited());
  expect({ stillRunning, devAtInstalled, left: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "devAtInstalled": {
        "kind": "refused",
        "reason": "A development run never resets the installed app's ~/.morrowbot.",
      },
      "left": [
        ".morrowbot/morrowbot.sqlite",
      ],
      "stillRunning": {
        "kind": "timed-out",
        "pids": [
          4242,
        ],
      },
    }
  `);
});
