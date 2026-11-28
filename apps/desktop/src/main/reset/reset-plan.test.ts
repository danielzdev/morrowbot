import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeHome, fakeKeychain, INFO_PLIST, type FakeHome } from './reset-fixture.ts';
import { RELEASE_TOKEN, SAFE_STORAGE } from './reset-paths.ts';
import { deleteRefusalNow, resetOptionsOf } from './reset-plan.ts';

let fake: FakeHome;
const KEYCHAIN = [RELEASE_TOKEN, SAFE_STORAGE, { service: 'Other App Safe Storage', account: 'Other App' }];

/** An installed Ori Kami with data, Library files, a skills link out of the data folder, and a shared workspace inside it. */
async function installed(): Promise<string> {
  await fake.file('.orikami/orikami.sqlite');
  await fake.file('.orikami/orikami.sqlite-wal');
  await fake.file('.orikami/host.lock.db');
  await fake.file('.orikami/server.json', '{"kind":"remote"}');
  await fake.file('.orikami/plugin-data/echo/account');
  await fake.file('.orikami/plugins/shared-workspace/notes.md');
  await fake.file('.orikami/workspaces/agent-1/todo.md');
  await fake.file('.orikami/notes-i-keep.txt');
  await fake.file('my-skills/skill.md');
  await fake.link('.orikami/skills', `${fake.home}/my-skills`);
  await fake.file('Library/Application Support/Ori Kami/Cookies');
  await fake.file('Library/Preferences/com.legendarykoi.orikami.plist');
  await fake.file('Library/Preferences/com.other.app.plist');
  await fake.file('Applications/Ori Kami.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.orikami'));
  return `${fake.home}/Applications/Ori Kami.app/Contents/MacOS/Ori Kami`;
}

beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

it('resolves every choice for the installed app to exact paths, keeping workspaces, links and files it did not make', async () => {
  const execPath = await installed();
  const context = fake.context('installed', '.orikami', [`${fake.home}/.orikami/plugins/shared-workspace`, `${fake.home}/code/app`]);
  const options = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain(KEYCHAIN));
  expect(fake.short(options)).toMatchInlineSnapshot(`
    [
      {
        "choice": "reset",
        "kept": [
          {
            "path": "~/.orikami/plugins",
            "reason": "An agent workspace, or holds one. Workspaces are never touched.",
          },
          {
            "path": "~/.orikami/skills",
            "reason": "A symbolic link. Ori Kami does not follow it.",
          },
          {
            "path": "~/.orikami/notes-i-keep.txt",
            "reason": "Not one of Ori Kami's own files.",
          },
          {
            "path": "~/.orikami/workspaces",
            "reason": "Agent workspaces are never touched.",
          },
          {
            "path": "Keychain: com.legendarykoi.orikami.releases (account releases)",
            "reason": "Needed for app updates while Ori Kami stays installed.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "delete",
            "path": "~/.orikami/orikami.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/orikami.sqlite-wal",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/host.lock.db",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/server.json",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/plugin-data",
          },
          {
            "kind": "delete",
            "path": "~/Library/Application Support/Ori Kami",
          },
          {
            "kind": "delete",
            "path": "~/Library/Preferences/com.legendarykoi.orikami.plist",
          },
          {
            "account": "Ori Kami",
            "kind": "keychain",
            "service": "Ori Kami Safe Storage",
          },
        ],
      },
      {
        "choice": "uninstall-app",
        "kept": [
          {
            "path": "~/.orikami",
            "reason": "Your agents, chats and settings stay for when you reinstall.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "trash",
            "path": "~/Applications/Ori Kami.app",
          },
        ],
      },
      {
        "choice": "full-uninstall",
        "kept": [
          {
            "path": "~/.orikami/plugins",
            "reason": "An agent workspace, or holds one. Workspaces are never touched.",
          },
          {
            "path": "~/.orikami/skills",
            "reason": "A symbolic link. Ori Kami does not follow it.",
          },
          {
            "path": "~/.orikami/notes-i-keep.txt",
            "reason": "Not one of Ori Kami's own files.",
          },
          {
            "path": "~/.orikami/workspaces",
            "reason": "Agent workspaces are never touched.",
          },
        ],
        "kind": "available",
        "steps": [
          {
            "kind": "trash",
            "path": "~/Applications/Ori Kami.app",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/orikami.sqlite",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/orikami.sqlite-wal",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/host.lock.db",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/server.json",
          },
          {
            "kind": "delete",
            "path": "~/.orikami/plugin-data",
          },
          {
            "kind": "delete",
            "path": "~/Library/Application Support/Ori Kami",
          },
          {
            "kind": "delete",
            "path": "~/Library/Preferences/com.legendarykoi.orikami.plist",
          },
          {
            "account": "Ori Kami",
            "kind": "keychain",
            "service": "Ori Kami Safe Storage",
          },
          {
            "account": "releases",
            "kind": "keychain",
            "service": "com.legendarykoi.orikami.releases",
          },
        ],
      },
    ]
  `);
});

it('a development run resets only its own folder and never offers to uninstall, even when the installed app and its data are there', async () => {
  const execPath = await installed();
  await fake.file('.orikami-dev/orikami.sqlite');
  await fake.file('.orikami-dev/desktop/Cookies');
  const keychain = fakeKeychain(KEYCHAIN);
  const summary = async (dataDir: string, packaged: boolean, exec = execPath) =>
    fake.short((await resetOptionsOf(fake.context('isolated', dataDir), { packaged, execPath: exec, updatePending: false }, keychain)).map((option) => (option.kind === 'available' ? { [option.choice]: option.steps } : { [option.choice]: option.reason })));
  expect({
    npmStart: await summary('.orikami-dev', false, '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    installedAppWithDataDir: await summary('.orikami-dev', true),
    pointedAtInstalledData: await summary('.orikami', true),
  }).toMatchInlineSnapshot(`
    {
      "installedAppWithDataDir": [
        {
          "reset": [
            {
              "kind": "delete",
              "path": "~/.orikami-dev/orikami.sqlite",
            },
            {
              "kind": "delete",
              "path": "~/.orikami-dev/desktop",
            },
          ],
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed Ori Kami.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed Ori Kami.app.",
        },
      ],
      "npmStart": [
        {
          "reset": [
            {
              "kind": "delete",
              "path": "~/.orikami-dev/orikami.sqlite",
            },
            {
              "kind": "delete",
              "path": "~/.orikami-dev/desktop",
            },
          ],
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed Ori Kami.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed Ori Kami.app.",
        },
      ],
      "pointedAtInstalledData": [
        {
          "reset": "A development run never resets the installed app's ~/.orikami.",
        },
        {
          "uninstall-app": "This is a development run. Uninstalling is offered only in the installed Ori Kami.app.",
        },
        {
          "full-uninstall": "This is a development run. Uninstalling is offered only in the installed Ori Kami.app.",
        },
      ],
    }
  `);
});

it('refuses to delete data while the host cannot list workspaces, and to trash the app while an update is pending or when the bundle is a link, is not Ori Kami, or is outside Applications', async () => {
  const execPath = await installed();
  const reasons = async (workspaces: readonly string[] | null, exec = execPath, updatePending = false) =>
    (await resetOptionsOf(fake.context('installed', '.orikami', workspaces), { packaged: true, execPath: exec, updatePending }, fakeKeychain([]))).map((option) => (option.kind === 'available' ? option.kind : option.reason));
  const hostDown = await reasons(null);
  const updatePending = await reasons([], execPath, true);
  const notInApplications = await reasons([], `${fake.home}/Downloads/Ori Kami.app/Contents/MacOS/Ori Kami`);
  await fake.file('Applications/Ori Kami.app/Contents/Info.plist', INFO_PLIST('com.other.app'));
  const wrongBundleId = await reasons([]);
  await rm(`${fake.home}/Applications/Ori Kami.app`, { recursive: true });
  await fake.file('elsewhere/Ori Kami.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.orikami'));
  await fake.link('Applications/Ori Kami.app', `${fake.home}/elsewhere/Ori Kami.app`);
  const linkedBundle = await reasons([]);
  await rm(`${fake.home}/Applications/Ori Kami.app`);
  await fake.file('Applications/Ori Kami.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.orikami'));
  const workspaceInBundle = await reasons([`${fake.home}/applications/ori kami.app/Contents/Resources/agent`]);
  expect({ hostDown, updatePending, notInApplications, wrongBundleId, linkedBundle, workspaceInBundle }).toMatchInlineSnapshot(`
    {
      "hostDown": [
        "Ori Kami can't list which folders its agents use right now, so it deletes nothing. Make sure its server is running and reachable (Settings › Server), then try again.",
        "available",
        "Ori Kami can't list which folders its agents use right now, so it deletes nothing. Make sure its server is running and reachable (Settings › Server), then try again.",
      ],
      "linkedBundle": [
        "available",
        "Ori Kami.app is a symbolic link or could not be checked.",
        "Ori Kami.app is a symbolic link or could not be checked.",
      ],
      "notInApplications": [
        "available",
        "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
        "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
      ],
      "updatePending": [
        "An update is on its way. Restart to update, or wait until it is done, then try again.",
        "An update is on its way. Restart to update, or wait until it is done, then try again.",
        "An update is on its way. Restart to update, or wait until it is done, then try again.",
      ],
      "workspaceInBundle": [
        "available",
        "An agent workspace is inside Ori Kami.app, or holds it. Move that workspace first.",
        "An agent workspace is inside Ori Kami.app, or holds it. Move that workspace first.",
      ],
      "wrongBundleId": [
        "available",
        "This app bundle is not com.legendarykoi.orikami.",
        "This app bundle is not com.legendarykoi.orikami.",
      ],
    }
  `);
});

it("keeps Electron's Safe Storage key while its profile folder stays, and protects workspaces spelt in another case", async () => {
  const execPath = await installed();
  const context = fake.context('installed', '.orikami', [`${fake.home}/LIBRARY/application support/ori kami/Workspace`]);
  const [reset] = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain(KEYCHAIN));
  const shownKept = (kept: readonly { readonly path: string }[]) => kept.filter((each) => each.path.includes('Application Support') || each.path.startsWith('Keychain'));
  expect(fake.short(reset?.kind === 'available' ? { keychain: reset.steps.filter((step) => step.kind === 'keychain'), kept: shownKept(reset.kept) } : reset)).toMatchInlineSnapshot(`
    {
      "kept": [
        {
          "path": "~/Library/Application Support/Ori Kami",
          "reason": "An agent workspace, or holds one. Workspaces are never touched.",
        },
        {
          "path": "Keychain: com.legendarykoi.orikami.releases (account releases)",
          "reason": "Needed for app updates while Ori Kami stays installed.",
        },
      ],
      "keychain": [],
    }
  `);
});

it.skipIf(process.platform !== 'darwin')('protects a workspace the host names by another path to the same folder, such as the Data volume firmlink', async () => {
  const execPath = await installed();
  await fake.file('.orikami/attachments/a.png');
  const alias = `/System/Volumes/Data${fake.home}`;
  const context = fake.context('installed', '.orikami', [`${alias}/.orikami/plugin-data/echo`, `${alias}/.orikami/attachments/not-made-yet`]);
  const [reset] = await resetOptionsOf(context, { packaged: true, execPath, updatePending: false }, fakeKeychain([]));
  const now = await deleteRefusalNow(context, `${fake.home}/.orikami/plugin-data`);
  const kept = reset?.kind === 'available' ? reset.kept.filter((each) => each.path.includes('plugin-data') || each.path.includes('attachments')) : reset;
  expect(fake.short({ kept, now })).toMatchInlineSnapshot(`
    {
      "kept": [
        {
          "path": "~/.orikami/attachments",
          "reason": "An agent workspace, or holds one. Workspaces are never touched.",
        },
        {
          "path": "~/.orikami/plugin-data",
          "reason": "An agent workspace, or holds one. Workspaces are never touched.",
        },
      ],
      "now": "An agent workspace, or holds one. Workspaces are never touched.",
    }
  `);
});

it("refuses only the choices that delete data when the login Keychain can't be checked", async () => {
  const execPath = await installed();
  const broken = { has: () => Promise.reject(new Error('The login Keychain is missing, so Ori Kami leaves the Keychain alone.')), remove: () => Promise.resolve() };
  const options = await resetOptionsOf(fake.context('installed', '.orikami'), { packaged: true, execPath, updatePending: false }, broken);
  expect(options.map((option) => (option.kind === 'available' ? `${option.choice}: available` : `${option.choice}: ${option.reason}`))).toMatchInlineSnapshot(`
    [
      "reset: The login Keychain is missing, so Ori Kami leaves the Keychain alone.",
      "uninstall-app: available",
      "full-uninstall: The login Keychain is missing, so Ori Kami leaves the Keychain alone.",
    ]
  `);
});

it('protects the folders above a workspace link that was repointed after the plan was made', async () => {
  await installed();
  await fake.file('elsewhere/notes.md');
  await fake.file('.orikami/plugin-data/echo/nested/todo.md');
  await fake.link('ws-link', `${fake.home}/elsewhere`);
  const context = fake.context('installed', '.orikami', [`${fake.home}/ws-link`, `${fake.home}/elsewhere`]);
  const before = await deleteRefusalNow(context, `${fake.home}/.orikami/plugin-data`);
  await rm(`${fake.home}/ws-link`);
  await fake.link('ws-link', `${fake.home}/.orikami/plugin-data/echo/nested`);
  expect({ before, after: await deleteRefusalNow(context, `${fake.home}/.orikami/plugin-data`) }).toMatchInlineSnapshot(`
    {
      "after": "An agent workspace, or holds one. Workspaces are never touched.",
      "before": null,
    }
  `);
});
