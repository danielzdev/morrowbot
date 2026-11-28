import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeHome, fakeKeychain, INFO_PLIST, type FakeHome } from './reset-fixture.ts';
import { RELEASE_TOKEN, SAFE_STORAGE } from './reset-paths.ts';
import { deleteRefusalNow, resetOptionsOf } from './reset-plan.ts';

let fake: FakeHome;
const KEYCHAIN = [RELEASE_TOKEN, SAFE_STORAGE, { service: 'Other App Safe Storage', account: 'Other App' }];

/** An installed Ori Bot with data, Library files, a skills link out of the data folder, and a shared workspace inside it. */
async function installed(): Promise<string> {
  await fake.file('.oribot/oribot.sqlite');
  await fake.file('.oribot/oribot.sqlite-wal');
  await fake.file('.oribot/host.lock.db');
  await fake.file('.oribot/server.json', '{"kind":"remote"}');
  await fake.file('.oribot/plugin-data/echo/account');
  await fake.file('.oribot/plugins/shared-workspace/notes.md');
  await fake.file('.oribot/workspaces/agent-1/todo.md');
  await fake.file('.oribot/notes-i-keep.txt');
  await fake.file('my-skills/skill.md');
  await fake.link('.oribot/skills', `${fake.home}/my-skills`);
  await fake.file('Library/Application Support/Ori Bot/Cookies');
  await fake.file('Library/Preferences/com.legendarykoi.oribot.plist');
  await fake.file('Library/Preferences/com.other.app.plist');
  await fake.file('Applications/Ori Bot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.oribot'));
  return `${fake.home}/Applications/Ori Bot.app/Contents/MacOS/Ori Bot`;
}

beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

it('resolves every choice for the installed app to exact paths, keeping workspaces, links and files it did not make', async () => {
  const execPath = await installed();
  const context = fake.context('installed', '.oribot', [`${fake.home}/.oribot/plugins/shared-workspace`, `${fake.home}/code/app`]);
  const options = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain(KEYCHAIN));
  expect(fake.short(options)).toMatchInlineSnapshot(`
    [
      {
        "choice": "reset",
        "kept": [
          {
            "path": "~/.oribot/plugins",
            "reason": "An agent workspace, or holds one. Workspaces are never touched.",
          },
          {
            "path": "~/.oribot/skills",
            "reason": "A symbolic link. Ori Bot does not follow it.",
          },
          {
            "path": "~/.oribot/notes-i-keep.txt",
            "reason": "Not one of Ori Bot's own files.",
          },
          {
            "path": "~/.oribot/workspaces",
            "reason": "Agent workspaces are never touched.",
          },
          {
            "path": "Keychain: com.legendarykoi.oribot.releases (account releases)",
            "reason": "Needed for app updates while Ori Bot stays installed.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "delete",
            "path": "~/.oribot/oribot.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/oribot.sqlite-wal",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/host.lock.db",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/server.json",
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
            "kind": "delete",
            "path": "~/Library/Preferences/com.legendarykoi.oribot.plist",
          },
          {
            "account": "Ori Bot",
            "kind": "keychain",
            "service": "Ori Bot Safe Storage",
          },
        ],
      },
      {
        "choice": "uninstall-app",
        "kept": [
          {
            "path": "~/.oribot",
            "reason": "Your agents, chats and settings stay for when you reinstall.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "trash",
            "path": "~/Applications/Ori Bot.app",
          },
        ],
      },
      {
        "choice": "full-uninstall",
        "kept": [
          {
            "path": "~/.oribot/plugins",
            "reason": "An agent workspace, or holds one. Workspaces are never touched.",
          },
          {
            "path": "~/.oribot/skills",
            "reason": "A symbolic link. Ori Bot does not follow it.",
          },
          {
            "path": "~/.oribot/notes-i-keep.txt",
            "reason": "Not one of Ori Bot's own files.",
          },
          {
            "path": "~/.oribot/workspaces",
            "reason": "Agent workspaces are never touched.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "trash",
            "path": "~/Applications/Ori Bot.app",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/oribot.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/oribot.sqlite-wal",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/host.lock.db",
          },
          {
            "kind": "delete",
            "path": "~/.oribot/server.json",
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
            "kind": "delete",
            "path": "~/Library/Preferences/com.legendarykoi.oribot.plist",
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
      },
    ]
  `);
});

it('a development run resets only its own folder and never offers to uninstall, even when the installed app and its data are there', async () => {
  const execPath = await installed();
  await fake.file('.oribot-dev/oribot.sqlite');
  await fake.file('.oribot-dev/desktop/Cookies');
  const keychain = fakeKeychain(KEYCHAIN);
  const summary = async (dataDir: string, packaged: boolean, exec = execPath) =>
    fake.short((await resetOptionsOf(fake.context('isolated', dataDir), { packaged, execPath: exec, updatePending: false }, keychain)).map((option) => (option.kind === 'available' ? { [option.choice]: option.steps } : { [option.choice]: option.reason })));
  expect({
    npmStart: await summary('.oribot-dev', false, '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    installedAppWithDataDir: await summary('.oribot-dev', true),
    pointedAtInstalledData: await summary('.oribot', true),
  }).toMatchInlineSnapshot(`
    {
      "installedAppWithDataDir": [
        {
          "reset": [
            {
              "kind": "delete",
              "path": "~/.oribot-dev/oribot.sqlite",
            },
            {
              "kind": "delete",
              "path": "~/.oribot-dev/desktop",
            },
          ],
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed Ori Bot.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed Ori Bot.app.",
        },
      ],
      "npmStart": [
        {
          "reset": [
            {
              "kind": "delete",
              "path": "~/.oribot-dev/oribot.sqlite",
            },
            {
              "kind": "delete",
              "path": "~/.oribot-dev/desktop",
            },
          ],
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed Ori Bot.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed Ori Bot.app.",
        },
      ],
      "pointedAtInstalledData": [
        {
          "reset": "A development run never resets the installed app's ~/.oribot.",
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed Ori Bot.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed Ori Bot.app.",
        },
      ],
    }
  `);
});

it('refuses to delete data while the host cannot list workspaces, and to trash the app while an update is pending or when the bundle is a link, is not Ori Bot, or is outside Applications', async () => {
  const execPath = await installed();
  const reasons = async (workspaces: readonly string[] | null, exec = execPath, updatePending = false) =>
    (await resetOptionsOf(fake.context('installed', '.oribot', workspaces), { packaged: true, execPath: exec, updatePending }, fakeKeychain([]))).map((option) => (option.kind === 'available' ? option.kind : option.reason));
  const hostDown = await reasons(null);
  const updatePending = await reasons([], execPath, true);
  const notInApplications = await reasons([], `${fake.home}/Downloads/Ori Bot.app/Contents/MacOS/Ori Bot`);
  await fake.file('Applications/Ori Bot.app/Contents/Info.plist', INFO_PLIST('com.other.app'));
  const wrongBundleId = await reasons([]);
  await rm(`${fake.home}/Applications/Ori Bot.app`, { recursive: true });
  await fake.file('elsewhere/Ori Bot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.oribot'));
  await fake.link('Applications/Ori Bot.app', `${fake.home}/elsewhere/Ori Bot.app`);
  const linkedBundle = await reasons([]);
  await rm(`${fake.home}/Applications/Ori Bot.app`);
  await fake.file('Applications/Ori Bot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.oribot'));
  const workspaceInBundle = await reasons([`${fake.home}/applications/ori bot.app/Contents/Resources/agent`]);
  expect({ hostDown, updatePending, notInApplications, wrongBundleId, linkedBundle, workspaceInBundle }).toMatchInlineSnapshot(`
    {
      "hostDown": [
        "Ori Bot can't list which folders its agents use right now, so it deletes nothing. Make sure its server is running and reachable (Settings › Server), then try again.",
        "available",
        "Ori Bot can't list which folders its agents use right now, so it deletes nothing. Make sure its server is running and reachable (Settings › Server), then try again.",
      ],
      "linkedBundle": [
        "available",
        "Ori Bot.app is a symbolic link or could not be checked.",
        "Ori Bot.app is a symbolic link or could not be checked.",
      ],
      "notInApplications": [
        "available",
        "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
        "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
      ],
      "updatePending": [
        "An update is on its way. Restart to update, or wait until it is done, then try again.",
        "An update is on its way. Restart to update, or wait until it is done, then try again.",
        "An update is on its way. Restart to update, or wait until it is done, then try again.",
      ],
      "workspaceInBundle": [
        "available",
        "An agent workspace is inside Ori Bot.app, or holds it. Move that workspace first.",
        "An agent workspace is inside Ori Bot.app, or holds it. Move that workspace first.",
      ],
      "wrongBundleId": [
        "available",
        "This app bundle is not com.legendarykoi.oribot.",
        "This app bundle is not com.legendarykoi.oribot.",
      ],
    }
  `);
});

it("keeps Electron's Safe Storage key while its profile folder stays, and protects workspaces spelt in another case", async () => {
  const execPath = await installed();
  const context = fake.context('installed', '.oribot', [`${fake.home}/LIBRARY/application support/ori bot/Workspace`]);
  const [reset] = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain(KEYCHAIN));
  const shownKept = (kept: readonly { readonly path: string }[]) => kept.filter((each) => each.path.includes('Application Support') || each.path.startsWith('Keychain'));
  expect(fake.short(reset?.kind === 'available' ? { keychain: reset.steps.filter((step) => step.kind === 'keychain'), kept: shownKept(reset.kept) } : reset)).toMatchInlineSnapshot(`
    {
      "kept": [
        {
          "path": "~/Library/Application Support/Ori Bot",
          "reason": "An agent workspace, or holds one. Workspaces are never touched.",
        },
        {
          "path": "Keychain: com.legendarykoi.oribot.releases (account releases)",
          "reason": "Needed for app updates while Ori Bot stays installed.",
        },
      ],
      "keychain": [],
    }
  `);
});

it.skipIf(process.platform !== 'darwin')('protects a workspace the host names by another path to the same folder, such as the Data volume firmlink', async () => {
  const execPath = await installed();
  await fake.file('.oribot/attachments/a.png');
  const alias = `/System/Volumes/Data${fake.home}`;
  const context = fake.context('installed', '.oribot', [`${alias}/.oribot/plugin-data/echo`, `${alias}/.oribot/attachments/not-made-yet`]);
  const [reset] = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain([]));
  const now = await deleteRefusalNow(context, `${fake.home}/.oribot/plugin-data`);
  const kept = reset?.kind === 'available' ? reset.kept.filter((each) => each.path.includes('plugin-data') || each.path.includes('attachments')) : reset;
  expect(fake.short({ kept, now })).toMatchInlineSnapshot(`
    {
      "kept": [
        {
          "path": "~/.oribot/attachments",
          "reason": "An agent workspace, or holds one. Workspaces are never touched.",
        },
        {
          "path": "~/.oribot/plugin-data",
          "reason": "An agent workspace, or holds one. Workspaces are never touched.",
        },
      ],
      "now": "An agent workspace, or holds one. Workspaces are never touched.",
    }
  `);
});

it("refuses only the choices that delete data when the login Keychain can't be checked", async () => {
  const execPath = await installed();
  const broken = { has: () => Promise.reject(new Error('The login Keychain is missing, so Ori Bot leaves the Keychain alone.')), remove: () => Promise.resolve() };
  const options = await resetOptionsOf(fake.context('installed', '.oribot'), { packaged: true, execPath, updatePending: false }, broken);
  expect(options.map((option) => (option.kind === 'available' ? `${option.choice}: available` : `${option.choice}: ${option.reason}`))).toMatchInlineSnapshot(`
    [
      "reset: The login Keychain is missing, so Ori Bot leaves the Keychain alone.",
      "uninstall-app: available",
      "full-uninstall: The login Keychain is missing, so Ori Bot leaves the Keychain alone.",
    ]
  `);
});

it('protects the folders above a workspace link that was repointed after the plan was made', async () => {
  await installed();
  await fake.file('elsewhere/notes.md');
  await fake.file('.oribot/plugin-data/echo/nested/todo.md');
  await fake.link('ws-link', `${fake.home}/elsewhere`);
  const context = fake.context('installed', '.oribot', [`${fake.home}/ws-link`, `${fake.home}/elsewhere`]);
  const before = await deleteRefusalNow(context, `${fake.home}/.oribot/plugin-data`);
  await rm(`${fake.home}/ws-link`);
  await fake.link('ws-link', `${fake.home}/.oribot/plugin-data/echo/nested`);
  expect({ before, after: await deleteRefusalNow(context, `${fake.home}/.oribot/plugin-data`) }).toMatchInlineSnapshot(`
    {
      "after": "An agent workspace, or holds one. Workspaces are never touched.",
      "before": null,
    }
  `);
});
