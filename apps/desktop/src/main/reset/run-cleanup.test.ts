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

it('removes exactly the confirmed Ori Bot files and Keychain items, and leaves workspaces, links, their targets and unknown files', async () => {
  await fake.file('.oribot/oribot.sqlite');
  await fake.file('.oribot/attachments/a.png');
  await fake.file('.oribot/workspaces/agent-1/todo.md');
  await fake.file('.oribot/mine.txt');
  await fake.file('my-skills/skill.md');
  await fake.link('.oribot/skills', `${fake.home}/my-skills`);
  await fake.file('.oribot/plugin-data/echo/link-target-outside.txt');
  await fake.link('.oribot/plugin-data/echo/outside', `${fake.home}/Documents`);
  await fake.file('Documents/report.txt');
  await fake.file('Library/Application Support/Ori Bot/Cookies');
  await fake.file('Library/Application Support/Other/keep.db');
  const keychain = fakeKeychain([RELEASE_TOKEN, SAFE_STORAGE, { service: SAFE_STORAGE.service, account: 'someone-else' }, { service: 'Other Safe Storage', account: 'Other' }]);
  const job = await confirmed(fake.context('installed', '.oribot'), keychain);
  const report = await runCleanup(job, exited(keychain));
  expect({ report: fake.short(report), left: await fake.tree(), keychain: [...keychain.items] }).toMatchInlineSnapshot(`
    {
      "keychain": [
        "Ori Bot Safe Storage / someone-else",
        "Other Safe Storage / Other",
      ],
      "left": [
        ".oribot/mine.txt",
        ".oribot/skills (link)",
        ".oribot/workspaces/agent-1/todo.md",
        "Documents/report.txt",
        "Library/Application Support/Other/keep.db",
        "my-skills/skill.md",
      ],
      "report": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.oribot/oribot.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/attachments",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/plugin-data",
          },
          {
            "kind": "delete",
            "path": "~/Library/Application Support/Ori Bot",
          },
          {
            "account": "Ori Bot",
            "kind": "keychain",
            "service": "Ori Bot Safe Storage",
          },
          {
            "account": "releases",
            "kind": "keychain",
            "service": "com.legendarykoi.oribot.releases",
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
  await fake.file('.oribot-dev/attachments/a.png');
  await fake.file('.oribot-dev/plugins/p/index.js');
  await fake.file('precious/keep.txt');
  const job = await confirmed(fake.context('isolated', '.oribot-dev'));
  await rm(`${fake.home}/.oribot-dev/plugins`, { recursive: true });
  await fake.link('.oribot-dev/plugins', `${fake.home}/precious`);
  const forged: CleanupJob = {
    ...job,
    approved: [...job.approved, { kind: 'trash', path: '/Applications/Ori Bot.app' }, { kind: 'delete', path: `${fake.home}/precious` }, { kind: 'delete', path: fake.home }],
  };
  const report = await runCleanup(forged, exited());
  expect({ report: fake.short(report), left: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "left": [
        ".oribot-dev/plugins (link)",
        "precious/keep.txt",
      ],
      "report": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.oribot-dev/attachments",
          },
        ],
        "failed": [],
        "kind": "done",
        "skipped": [
          {
            "kind": "delete",
            "path": "~/.oribot-dev/plugins",
          },
          {
            "kind": "trash",
            "path": "/Applications/Ori Bot.app",
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

it('touches nothing while Ori Bot is still running, or when the job aims at the installed data from a development run', async () => {
  await fake.file('.oribot/oribot.sqlite');
  const job = await confirmed(fake.context('installed', '.oribot'));
  const stillRunning = await runCleanup(job, { ...exited(), isAlive: (pid) => pid === 4242 });
  const devAtInstalled = await runCleanup({ ...job, context: fake.context('isolated', '.oribot') }, exited());
  expect({ stillRunning, devAtInstalled, left: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "devAtInstalled": {
        "kind": "refused",
        "reason": "A development run never resets the installed app's ~/.oribot.",
      },
      "left": [
        ".oribot/oribot.sqlite",
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
  await fake.file('.oribot/attachments/a.png');
  await fake.file('.oribot/plugins/p/index.js');
  await fake.file('precious/keep.txt');
  const locked = fakeKeychain([RELEASE_TOKEN], [RELEASE_TOKEN]);
  const job = await confirmed(fake.context('installed', '.oribot'), locked);
  let armed = true;
  const swapping = {
    ...locked,
    /** Runs after the helper's fresh plan has read the files: swaps a planned folder for a link before it is deleted. */
    has: async (item: typeof RELEASE_TOKEN) => {
      if (armed) {
        armed = false;
        await rm(`${fake.home}/.oribot/plugins`, { recursive: true });
        await fake.link('.oribot/plugins', `${fake.home}/precious`);
      }
      return locked.has(item);
    },
  };
  const report = await runCleanup(job, { ...exited(), keychain: swapping });
  expect({ report: fake.short(report), left: await fake.tree() }).toMatchInlineSnapshot(`
    {
      "left": [
        ".oribot/plugins (link)",
        "precious/keep.txt",
      ],
      "report": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.oribot/attachments",
          },
        ],
        "failed": [
          {
            "error": "The Keychain refused to delete com.legendarykoi.oribot.releases.",
            "step": {
              "account": "releases",
              "kind": "keychain",
              "service": "com.legendarykoi.oribot.releases",
            },
          },
        ],
        "kind": "done",
        "skipped": [
          {
            "kind": "delete",
            "path": "~/.oribot/plugins",
          },
        ],
      },
    }
  `);
});

it("keeps Electron's Safe Storage key when its profile folder could not be deleted, and never deletes a path it cannot check", async () => {
  await fake.file('.oribot/attachments/a.png');
  await fake.file('Library/Application Support/Ori Bot/Cookies');
  const keychain = fakeKeychain([SAFE_STORAGE]);
  const job = await confirmed(fake.context('installed', '.oribot'), keychain);
  const profile = `${fake.home}/Library/Application Support/Ori Bot`;
  await chmod(profile, 0o500);
  const report = await runCleanup(job, exited(keychain));
  await chmod(profile, 0o700);
  await chmod(`${fake.home}/.oribot`, 0o000);
  const unreadable = await deleteRefusalNow(job.context, `${fake.home}/.oribot/attachments`);
  await chmod(`${fake.home}/.oribot`, 0o700);
  const summary = report.kind === 'done' ? { done: report.done, skipped: report.skipped, failed: report.failed.map(({ step }) => step) } : report;
  expect(fake.short({ summary, keychain: [...keychain.items], unreadable })).toMatchInlineSnapshot(`
    {
      "keychain": [
        "Ori Bot Safe Storage / Ori Bot",
      ],
      "summary": {
        "done": [
          {
            "kind": "delete",
            "path": "~/.oribot/attachments",
          },
        ],
        "failed": [
          {
            "kind": "delete",
            "path": "~/Library/Application Support/Ori Bot",
          },
        ],
        "skipped": [
          {
            "account": "Ori Bot",
            "kind": "keychain",
            "service": "Ori Bot Safe Storage",
          },
        ],
      },
      "unreadable": "Ori Bot could not check it, so it stays.",
    }
  `);
});
