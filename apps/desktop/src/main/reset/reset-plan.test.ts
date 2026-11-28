import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeHome, fakeKeychain, INFO_PLIST, type FakeHome } from './reset-fixture.ts';
import { resetOptionsOf } from './reset-plan.ts';

let fake: FakeHome;
const KEYCHAIN = ['com.legendarykoi.morrowbot.releases', 'Other App Safe Storage'];

/** An installed MorrowBot with data, Library files, a skills link out of the data folder, and a shared workspace inside it. */
async function installed(): Promise<string> {
  await fake.file('.morrowbot/morrowbot.sqlite');
  await fake.file('.morrowbot/morrowbot.sqlite-wal');
  await fake.file('.morrowbot/host.lock.db');
  await fake.file('.morrowbot/plugin-data/echo/account');
  await fake.file('.morrowbot/plugins/shared-workspace/notes.md');
  await fake.file('.morrowbot/workspaces/agent-1/todo.md');
  await fake.file('.morrowbot/notes-i-keep.txt');
  await fake.file('my-skills/skill.md');
  await fake.link('.morrowbot/skills', `${fake.home}/my-skills`);
  await fake.file('Library/Application Support/MorrowBot/Cookies');
  await fake.file('Library/Preferences/com.legendarykoi.morrowbot.plist');
  await fake.file('Library/Preferences/com.other.app.plist');
  await fake.file('Applications/MorrowBot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.morrowbot'));
  return `${fake.home}/Applications/MorrowBot.app/Contents/MacOS/MorrowBot`;
}

beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

it('resolves every choice for the installed app to exact paths, keeping workspaces, links and files it did not make', async () => {
  const execPath = await installed();
  const context = fake.context('installed', '.morrowbot', [`${fake.home}/.morrowbot/plugins/shared-workspace`, `${fake.home}/code/app`]);
  const options = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain(KEYCHAIN));
  expect(fake.short(options)).toMatchInlineSnapshot(`
    [
      {
        "choice": "reset",
        "kept": [
          {
            "path": "~/.morrowbot/plugins",
            "reason": "An agent workspace, or holds one. Workspaces are never touched.",
          },
          {
            "path": "~/.morrowbot/skills",
            "reason": "A symbolic link. MorrowBot does not follow it.",
          },
          {
            "path": "~/.morrowbot/notes-i-keep.txt",
            "reason": "Not one of MorrowBot's own files.",
          },
          {
            "path": "~/.morrowbot/workspaces",
            "reason": "Agent workspaces are never touched.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "delete",
            "path": "~/.morrowbot/morrowbot.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/morrowbot.sqlite-wal",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/host.lock.db",
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
            "kind": "delete",
            "path": "~/Library/Preferences/com.legendarykoi.morrowbot.plist",
          },
          {
            "kind": "keychain",
            "service": "com.legendarykoi.morrowbot.releases",
          },
        ],
      },
      {
        "choice": "uninstall-app",
        "kept": [
          {
            "path": "~/.morrowbot",
            "reason": "Your agents, chats and settings stay for when you reinstall.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "trash",
            "path": "~/Applications/MorrowBot.app",
          },
        ],
      },
      {
        "choice": "full-uninstall",
        "kept": [
          {
            "path": "~/.morrowbot/plugins",
            "reason": "An agent workspace, or holds one. Workspaces are never touched.",
          },
          {
            "path": "~/.morrowbot/skills",
            "reason": "A symbolic link. MorrowBot does not follow it.",
          },
          {
            "path": "~/.morrowbot/notes-i-keep.txt",
            "reason": "Not one of MorrowBot's own files.",
          },
          {
            "path": "~/.morrowbot/workspaces",
            "reason": "Agent workspaces are never touched.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "trash",
            "path": "~/Applications/MorrowBot.app",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/morrowbot.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/morrowbot.sqlite-wal",
          },
          {
            "kind": "delete",
            "path": "~/.morrowbot/host.lock.db",
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
            "kind": "delete",
            "path": "~/Library/Preferences/com.legendarykoi.morrowbot.plist",
          },
          {
            "kind": "keychain",
            "service": "com.legendarykoi.morrowbot.releases",
          },
        ],
      },
    ]
  `);
});

it('a development run resets only its own folder and never offers to uninstall, even when the installed app and its data are there', async () => {
  const execPath = await installed();
  await fake.file('.morrowbot-dev/morrowbot.sqlite');
  await fake.file('.morrowbot-dev/desktop/Cookies');
  const keychain = fakeKeychain(KEYCHAIN);
  const summary = async (dataDir: string, packaged: boolean, exec = execPath) =>
    fake.short((await resetOptionsOf(fake.context('isolated', dataDir), { packaged, execPath: exec, updatePending: false }, keychain)).map((option) => (option.kind === 'available' ? { [option.choice]: option.steps } : { [option.choice]: option.reason })));
  expect({
    npmStart: await summary('.morrowbot-dev', false, '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    installedAppWithDataDir: await summary('.morrowbot-dev', true),
    pointedAtInstalledData: await summary('.morrowbot', true),
  }).toMatchInlineSnapshot(`
    {
      "installedAppWithDataDir": [
        {
          "reset": [
            {
              "kind": "delete",
              "path": "~/.morrowbot-dev/morrowbot.sqlite",
            },
            {
              "kind": "delete",
              "path": "~/.morrowbot-dev/desktop",
            },
          ],
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed MorrowBot.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed MorrowBot.app.",
        },
      ],
      "npmStart": [
        {
          "reset": [
            {
              "kind": "delete",
              "path": "~/.morrowbot-dev/morrowbot.sqlite",
            },
            {
              "kind": "delete",
              "path": "~/.morrowbot-dev/desktop",
            },
          ],
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed MorrowBot.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed MorrowBot.app.",
        },
      ],
      "pointedAtInstalledData": [
        {
          "reset": "A development run never resets the installed app's ~/.morrowbot.",
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed MorrowBot.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed MorrowBot.app.",
        },
      ],
    }
  `);
});

it('refuses to delete data while the host cannot list workspaces, and to trash the app while an update is pending or when the bundle is a link, is not MorrowBot, or is outside Applications', async () => {
  const execPath = await installed();
  const reasons = async (workspaces: readonly string[] | null, exec = execPath, updatePending = false) =>
    (await resetOptionsOf(fake.context('installed', '.morrowbot', workspaces), { packaged: true, execPath: exec, updatePending }, fakeKeychain([]))).map((option) => (option.kind === 'available' ? option.kind : option.reason));
  const hostDown = await reasons(null);
  const updatePending = await reasons([], execPath, true);
  const notInApplications = await reasons([], `${fake.home}/Downloads/MorrowBot.app/Contents/MacOS/MorrowBot`);
  await fake.file('Applications/MorrowBot.app/Contents/Info.plist', INFO_PLIST('com.other.app'));
  const wrongBundleId = await reasons([]);
  await rm(`${fake.home}/Applications/MorrowBot.app`, { recursive: true });
  await fake.file('elsewhere/MorrowBot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.morrowbot'));
  await fake.link('Applications/MorrowBot.app', `${fake.home}/elsewhere/MorrowBot.app`);
  const linkedBundle = await reasons([]);
  expect({ hostDown, updatePending, notInApplications, wrongBundleId, linkedBundle }).toMatchInlineSnapshot(`
    {
      "hostDown": [
        "MorrowBot's host isn't running, so it can't check which folders your agents use. Restart MorrowBot and try again.",
        "available",
        "MorrowBot's host isn't running, so it can't check which folders your agents use. Restart MorrowBot and try again.",
      ],
      "linkedBundle": [
        "available",
        "MorrowBot.app is a symbolic link or could not be checked.",
        "MorrowBot.app is a symbolic link or could not be checked.",
      ],
      "notInApplications": [
        "available",
        "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
        "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
      ],
      "updatePending": [
        "available",
        "An update is on its way. Restart to update, or wait until it is done, then uninstall.",
        "An update is on its way. Restart to update, or wait until it is done, then uninstall.",
      ],
      "wrongBundleId": [
        "available",
        "This app bundle is not com.legendarykoi.morrowbot.",
        "This app bundle is not com.legendarykoi.morrowbot.",
      ],
    }
  `);
});
