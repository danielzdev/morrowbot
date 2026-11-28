import { chmod, rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CleanupJob } from './cleanup-job.ts';
import { fakeHome, fakeKeychain, type FakeHome } from './reset-fixture.ts';
import { RELEASE_TOKEN, SAFE_STORAGE } from './reset-paths.ts';
import { dataPlanOf, deleteRefusalNow, type DataChoice } from './reset-plan.ts';
import { runCleanup, type CleanupDeps } from './run-cleanup.ts';

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

const exited = (keychain = fakeKeychain([])): CleanupDeps => ({ keychain, isAlive: () => false, sleep: () => Promise.resolve(), beat: () => undefined });

/** The steps the user would confirm for `context` right now. */
async function confirmed(context: CleanupJob['context'], keychain = fakeKeychain([]), choice: DataChoice = 'full-uninstall'): Promise<CleanupJob> {
  const plan = await dataPlanOf(context, choice, keychain);
  if (plan.kind === 'refused') throw new Error(plan.reason);
  return { choice: choice === 'reset' ? { kind: 'reset', relaunch: { command: process.execPath, args: [], cwd: '/' } } : { kind: 'full-uninstall' }, context, approved: plan.steps, waitPids: [4242] };
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
  const keychain = fakeKeychain([RELEASE_TOKEN, SAFE_STORAGE, { service: SAFE_STORAGE.service, account: 'someone-else' }, { service: 'Other Safe Storage', account: 'Other' }]);
  const job = await confirmed(fake.context('installed', '.morrowbot'), keychain);
  const report = await runCleanup(job, exited(keychain));
  expect({ report: fake.short(report), left: await fake.tree(), keychain: [...keychain.items] }).toMatchInlineSnapshot(`
    {
      "keychain": [
        "MorrowBot Safe Storage / someone-else",
        "Other Safe Storage / Other",
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
            "account": "MorrowBot Key",
            "kind": "keychain",
            "service": "MorrowBot Safe Storage",
          },
          {
            "account": "releases",
            "kind": "keychain",
            "service": "com.legendarykoi.morrowbot.releases",
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

it('checks each path on disk again just before deleting it, and reports a Keychain item it could not delete', async () => {
  await fake.file('.morrowbot/attachments/a.png');
  await fake.file('.morrowbot/plugins/p/index.js');
  await fake.file('precious/keep.txt');
  const locked = fakeKeychain([RELEASE_TOKEN], [RELEASE_TOKEN]);
  const job = await confirmed(fake.context('installed', '.morrowbot'), locked);
  let armed = true;
  const swapping = {
    ...locked,
    /** Runs after the helper's fresh plan has read the files: swaps a planned folder for a link before it is deleted. */
    has: async (item: typeof RELEASE_TOKEN) => {
      if (armed) {
        armed = false;
        await rm(`${fake.home}/.morrowbot/plugins`, { recursive: true });
        await fake.link('.morrowbot/plugins', `${fake.home}/precious`);
      }
      return locked.has(item);
    },
  };
  const report = await runCleanup(job, { ...exited(), keychain: swapping });
  expect({ report: fake.short(report), left: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "left": [
        ".morrowbot/plugins (link)",
        "precious/keep.txt",
      ],
      "report": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.morrowbot/attachments",
          },
        ],
        "failed": [
          {
            "error": "The Keychain refused to delete com.legendarykoi.morrowbot.releases.",
            "step": {
              "account": "releases",
              "kind": "keychain",
              "service": "com.legendarykoi.morrowbot.releases",
            },
          },
        ],
        "kind": "done",
        "skipped": [
          {
            "kind": "delete",
            "path": "~/.morrowbot/plugins",
          },
        ],
      },
    }
  `);
});

it("keeps Electron's Safe Storage key when its profile folder could not be deleted, and never deletes a path it cannot check", async () => {
  await fake.file('.morrowbot/attachments/a.png');
  await fake.file('Library/Application Support/MorrowBot/Cookies');
  const keychain = fakeKeychain([SAFE_STORAGE]);
  const job = await confirmed(fake.context('installed', '.morrowbot'), keychain);
  const profile = `${fake.home}/Library/Application Support/MorrowBot`;
  await chmod(profile, 0o500);
  const report = await runCleanup(job, exited(keychain));
  await chmod(profile, 0o700);
  await chmod(`${fake.home}/.morrowbot`, 0o000);
  const unreadable = await deleteRefusalNow(job.context, `${fake.home}/.morrowbot/attachments`);
  await chmod(`${fake.home}/.morrowbot`, 0o700);
  const summary = report.kind === 'done' ? { done: report.done, skipped: report.skipped, failed: report.failed.map(({ step }) => step) } : report;
  expect(fake.short({ summary, keychain: [...keychain.items], unreadable })).toMatchInlineSnapshot(`
    {
      "keychain": [
        "MorrowBot Safe Storage / MorrowBot Key",
      ],
      "summary": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.morrowbot/attachments",
          },
        ],
        "failed": [
          {
            "kind": "delete",
            "path": "~/Library/Application Support/MorrowBot",
          },
        ],
        "skipped": [
          {
            "account": "MorrowBot Key",
            "kind": "keychain",
            "service": "MorrowBot Safe Storage",
          },
        ],
      },
      "unreadable": "MorrowBot could not check it, so it stays.",
    }
  `);
});
