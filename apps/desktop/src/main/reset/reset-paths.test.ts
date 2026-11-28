import { expect, it } from 'vitest';
import { bundleIdIn, bundleOf, dataDirRefusal, deleteCandidatesOf, refusalOf, workspacesOf, type ResetContext } from './reset-paths.ts';

const HOME = '/Users/tester';
const context = (kind: 'installed' | 'isolated', dataDir: string, workspaces: readonly string[] | null = []): ResetContext => ({
  platform: 'darwin',
  homeDir: HOME,
  profile: { kind, dataDir },
  workspaces,
});

it('cleans the data folder only where the profile allows: never ~/.morrowbot from a development run, never outside home', () => {
  expect({
    installed: dataDirRefusal(context('installed', `${HOME}/.morrowbot`)),
    installedElsewhere: dataDirRefusal(context('installed', `${HOME}/other`)),
    dev: dataDirRefusal(context('isolated', `${HOME}/.morrowbot-dev`)),
    customInHome: dataDirRefusal(context('isolated', `${HOME}/try/morrowbot`)),
    devPointedAtInstalled: dataDirRefusal(context('isolated', `${HOME}/.morrowbot`)),
    devPointedAtInstalledOtherCase: dataDirRefusal(context('isolated', `${HOME}/.MorrowBot`)),
    devInsideInstalled: dataDirRefusal(context('isolated', `${HOME}/.morrowbot/nested`)),
    devHoldingInstalled: dataDirRefusal(context('isolated', HOME)),
    devOutsideHome: dataDirRefusal(context('isolated', '/tmp/screens')),
    devRoot: dataDirRefusal(context('isolated', '/')),
    dotted: dataDirRefusal(context('isolated', `${HOME}/a/../.morrowbot`)),
  }).toMatchInlineSnapshot(`
    {
      "customInHome": "A development run resets only ~/.morrowbot-dev. This run uses another folder (MORROWBOT_DATA_DIR); delete it yourself if you no longer need it.",
      "dev": null,
      "devHoldingInstalled": "A development run never resets the installed app's ~/.morrowbot.",
      "devInsideInstalled": "A development run never resets the installed app's ~/.morrowbot.",
      "devOutsideHome": "A development run resets only ~/.morrowbot-dev. This run uses another folder (MORROWBOT_DATA_DIR); delete it yourself if you no longer need it.",
      "devPointedAtInstalled": "A development run never resets the installed app's ~/.morrowbot.",
      "devPointedAtInstalledOtherCase": "A development run never resets the installed app's ~/.morrowbot.",
      "devRoot": "A development run never resets the installed app's ~/.morrowbot.",
      "dotted": "The data folder is not a plain absolute path.",
      "installed": null,
      "installedElsewhere": "The installed app keeps its data only in ~/.morrowbot.",
    }
  `);
});

it('lists only MorrowBot-owned entries: the installed app adds its Library files, a development run only its own folder', () => {
  const short = (ctx: ResetContext) => deleteCandidatesOf(ctx).map(({ path, root }) => `${path.replace(HOME, '~')} (in ${root.replace(HOME, '~')})`);
  expect({ installed: short(context('installed', `${HOME}/.morrowbot`)), dev: short(context('isolated', `${HOME}/.morrowbot-dev`)) }).toMatchInlineSnapshot(`
    {
      "dev": [
        "~/.morrowbot-dev/morrowbot.sqlite (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/morrowbot.sqlite-wal (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/morrowbot.sqlite-shm (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/morrowbot.sqlite-journal (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/host.lock.db (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/host.lock.db-journal (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/host.lock.db-wal (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/host.lock.db-shm (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/launch.json (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/launch.json.tmp (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/server.json (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/server.json.tmp (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/attachments (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/instructions-drafts (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/plugin-data (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/plugins (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/sign-in (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/skills (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/t3-watch (in ~/.morrowbot-dev)",
        "~/.morrowbot-dev/desktop (in ~/.morrowbot-dev)",
      ],
      "installed": [
        "~/.morrowbot/morrowbot.sqlite (in ~/.morrowbot)",
        "~/.morrowbot/morrowbot.sqlite-wal (in ~/.morrowbot)",
        "~/.morrowbot/morrowbot.sqlite-shm (in ~/.morrowbot)",
        "~/.morrowbot/morrowbot.sqlite-journal (in ~/.morrowbot)",
        "~/.morrowbot/host.lock.db (in ~/.morrowbot)",
        "~/.morrowbot/host.lock.db-journal (in ~/.morrowbot)",
        "~/.morrowbot/host.lock.db-wal (in ~/.morrowbot)",
        "~/.morrowbot/host.lock.db-shm (in ~/.morrowbot)",
        "~/.morrowbot/launch.json (in ~/.morrowbot)",
        "~/.morrowbot/launch.json.tmp (in ~/.morrowbot)",
        "~/.morrowbot/server.json (in ~/.morrowbot)",
        "~/.morrowbot/server.json.tmp (in ~/.morrowbot)",
        "~/.morrowbot/attachments (in ~/.morrowbot)",
        "~/.morrowbot/instructions-drafts (in ~/.morrowbot)",
        "~/.morrowbot/plugin-data (in ~/.morrowbot)",
        "~/.morrowbot/plugins (in ~/.morrowbot)",
        "~/.morrowbot/sign-in (in ~/.morrowbot)",
        "~/.morrowbot/skills (in ~/.morrowbot)",
        "~/.morrowbot/t3-watch (in ~/.morrowbot)",
        "~/Library/Application Support/MorrowBot (in ~)",
        "~/Library/Caches/com.legendarykoi.morrowbot (in ~)",
        "~/Library/Caches/com.legendarykoi.morrowbot.ShipIt (in ~)",
        "~/Library/Caches/morrowbot-updater (in ~)",
        "~/Library/HTTPStorages/com.legendarykoi.morrowbot (in ~)",
        "~/Library/Logs/MorrowBot (in ~)",
        "~/Library/Preferences/com.legendarykoi.morrowbot.plist (in ~)",
        "~/Library/Saved Application State/com.legendarykoi.morrowbot.savedState (in ~)",
      ],
    }
  `);
});

it('refuses /, home and its parents, anything outside its root, dotted paths, symbolic links, and anything holding or inside an agent workspace, in any case or Unicode form', () => {
  const ctx = context('installed', `${HOME}/.morrowbot`, [`${HOME}/code/app`, `${HOME}/.morrowbot/skills/shared`, `${HOME}/caf\u00e9`]);
  const workspaces = workspacesOf(ctx);
  const data = `${HOME}/.morrowbot`;
  const check = (target: string, root = data, facts: Parameters<typeof refusalOf>[3] = { kind: 'present', realPath: target }) => refusalOf(target, root, HOME, facts, workspaces);
  expect({
    ok: check(`${data}/attachments`),
    root: check('/', '/'),
    home: check(HOME, HOME),
    homeParent: check('/Users', '/'),
    theRootItself: check(data),
    outsideRoot: check(`${HOME}/Documents`),
    dotted: check(`${data}/../Documents`),
    relative: check('.morrowbot/attachments'),
    symlink: check(`${data}/plugins`, data, { kind: 'symlink' }),
    throughSymlink: check(`${data}/attachments`, data, { kind: 'present', realPath: '/Volumes/Other/attachments' }),
    dedicatedWorkspaces: check(`${data}/workspaces`),
    insideDedicated: check(`${data}/workspaces/agent-1`),
    holdsSharedWorkspace: check(`${data}/skills`),
    insideOutsideWorkspace: check(`${HOME}/code/app/.morrowbot`, HOME),
    rootOutsideHome: check('/Applications/MorrowBot.app', '/Applications'),
    dotDotName: check(`${data}/..attachments`),
    holdsOutsideWorkspace: check(`${HOME}/code`, HOME),
    insideWorkspaceOtherCase: check(`${HOME}/CODE/App/.morrowbot`, HOME),
    insideWorkspaceOtherUnicodeForm: check(`${HOME}/cafe\u0301/notes`, HOME),
    dedicatedOtherCase: check(`${data}/Workspaces`),
  }).toMatchInlineSnapshot(`
    {
      "dedicatedOtherCase": "An agent workspace, or holds one. Workspaces are never touched.",
      "dedicatedWorkspaces": "An agent workspace, or holds one. Workspaces are never touched.",
      "dotDotName": null,
      "dotted": "Not a plain absolute path.",
      "holdsOutsideWorkspace": "An agent workspace, or holds one. Workspaces are never touched.",
      "holdsSharedWorkspace": "An agent workspace, or holds one. Workspaces are never touched.",
      "home": "Outside MorrowBot's own folders.",
      "homeParent": "Outside MorrowBot's own folders.",
      "insideDedicated": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideOutsideWorkspace": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideWorkspaceOtherCase": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideWorkspaceOtherUnicodeForm": "An agent workspace, or holds one. Workspaces are never touched.",
      "ok": null,
      "outsideRoot": "Outside MorrowBot's own folders.",
      "relative": "Not a plain absolute path.",
      "root": "Outside MorrowBot's own folders.",
      "rootOutsideHome": "Outside MorrowBot's own folders.",
      "symlink": "A symbolic link. MorrowBot does not follow it.",
      "theRootItself": "Outside MorrowBot's own folders.",
      "throughSymlink": "Reached through a symbolic link. MorrowBot does not follow it.",
    }
  `);
});

it('finds MorrowBot.app only as the bundle holding the running binary, inside an Applications folder', () => {
  const exec = (bundle: string) => `${bundle}/Contents/MacOS/MorrowBot`;
  expect({
    system: bundleOf(exec('/Applications/MorrowBot.app'), HOME),
    user: bundleOf(exec(`${HOME}/Applications/MorrowBot.app`), HOME),
    renamed: bundleOf(exec('/Applications/Other.app'), HOME),
    nested: bundleOf(exec('/Applications/Tools/MorrowBot.app'), HOME),
    diskImage: bundleOf(exec('/Volumes/MorrowBot/MorrowBot.app'), HOME),
    translocated: bundleOf(exec('/private/var/folders/x/AppTranslocation/1/d/MorrowBot.app'), HOME),
    devElectron: bundleOf('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', HOME),
    notABundle: bundleOf('/usr/local/bin/node', HOME),
    dotted: bundleOf('/Applications/x/../MorrowBot.app/Contents/MacOS/MorrowBot', HOME),
  }).toMatchInlineSnapshot(`
    {
      "devElectron": {
        "kind": "refused",
        "reason": "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "diskImage": {
        "kind": "refused",
        "reason": "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "dotted": {
        "kind": "refused",
        "reason": "MorrowBot is not running from an app bundle.",
      },
      "nested": {
        "kind": "refused",
        "reason": "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "notABundle": {
        "kind": "refused",
        "reason": "MorrowBot is not running from an app bundle.",
      },
      "renamed": {
        "kind": "refused",
        "reason": "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "system": {
        "kind": "bundle",
        "path": "/Applications/MorrowBot.app",
      },
      "translocated": {
        "kind": "refused",
        "reason": "Uninstalling works only for MorrowBot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "user": {
        "kind": "bundle",
        "path": "/Users/tester/Applications/MorrowBot.app",
      },
    }
  `);
  expect([bundleIdIn('<key>CFBundleIdentifier</key>\n    <string>com.legendarykoi.morrowbot</string>'), bundleIdIn('<key>CFBundleName</key><string>x</string>')]).toEqual(['com.legendarykoi.morrowbot', null]);
});
