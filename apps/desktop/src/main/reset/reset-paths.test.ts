import { expect, it } from 'vitest';
import { bundleIdIn, bundleOf, dataDirRefusal, deleteCandidatesOf, refusalOf, workspacesOf, type ResetContext } from './reset-paths.ts';

const HOME = '/Users/tester';
const context = (kind: 'installed' | 'isolated', dataDir: string, workspaces: readonly string[] | null = []): ResetContext => ({
  platform: 'darwin',
  homeDir: HOME,
  profile: { kind, dataDir },
  workspaces,
});

it('cleans the data folder only where the profile allows: never ~/.oribot from a development run, never outside home', () => {
  expect({
    installed: dataDirRefusal(context('installed', `${HOME}/.oribot`)),
    installedElsewhere: dataDirRefusal(context('installed', `${HOME}/other`)),
    dev: dataDirRefusal(context('isolated', `${HOME}/.oribot-dev`)),
    customInHome: dataDirRefusal(context('isolated', `${HOME}/try/oribot`)),
    devPointedAtInstalled: dataDirRefusal(context('isolated', `${HOME}/.oribot`)),
    devPointedAtInstalledOtherCase: dataDirRefusal(context('isolated', `${HOME}/.OriBot`)),
    devInsideInstalled: dataDirRefusal(context('isolated', `${HOME}/.oribot/nested`)),
    devHoldingInstalled: dataDirRefusal(context('isolated', HOME)),
    devOutsideHome: dataDirRefusal(context('isolated', '/tmp/screens')),
    devRoot: dataDirRefusal(context('isolated', '/')),
    dotted: dataDirRefusal(context('isolated', `${HOME}/a/../.oribot`)),
  }).toMatchInlineSnapshot(`
    {
      "customInHome": "A development run resets only ~/.oribot-dev. This run uses another folder (ORIBOT_DATA_DIR); delete it yourself if you no longer need it.",
      "dev": null,
      "devHoldingInstalled": "A development run never resets the installed app's ~/.oribot.",
      "devInsideInstalled": "A development run never resets the installed app's ~/.oribot.",
      "devOutsideHome": "A development run resets only ~/.oribot-dev. This run uses another folder (ORIBOT_DATA_DIR); delete it yourself if you no longer need it.",
      "devPointedAtInstalled": "A development run never resets the installed app's ~/.oribot.",
      "devPointedAtInstalledOtherCase": "A development run never resets the installed app's ~/.oribot.",
      "devRoot": "A development run never resets the installed app's ~/.oribot.",
      "dotted": "The data folder is not a plain absolute path.",
      "installed": null,
      "installedElsewhere": "The installed app keeps its data only in ~/.oribot.",
    }
  `);
});

it('lists only the entries Ori Bot owns: the installed app adds its Library files, a development run only its own folder', () => {
  const short = (ctx: ResetContext) => deleteCandidatesOf(ctx).map(({ path, root }) => `${path.replace(HOME, '~')} (in ${root.replace(HOME, '~')})`);
  expect({ installed: short(context('installed', `${HOME}/.oribot`)), dev: short(context('isolated', `${HOME}/.oribot-dev`)) }).toMatchInlineSnapshot(`
    {
      "dev": [
        "~/.oribot-dev/oribot.sqlite (in ~/.oribot-dev)",
        "~/.oribot-dev/oribot.sqlite-wal (in ~/.oribot-dev)",
        "~/.oribot-dev/oribot.sqlite-shm (in ~/.oribot-dev)",
        "~/.oribot-dev/oribot.sqlite-journal (in ~/.oribot-dev)",
        "~/.oribot-dev/host.lock.db (in ~/.oribot-dev)",
        "~/.oribot-dev/host.lock.db-journal (in ~/.oribot-dev)",
        "~/.oribot-dev/host.lock.db-wal (in ~/.oribot-dev)",
        "~/.oribot-dev/host.lock.db-shm (in ~/.oribot-dev)",
        "~/.oribot-dev/launch.json (in ~/.oribot-dev)",
        "~/.oribot-dev/launch.json.tmp (in ~/.oribot-dev)",
        "~/.oribot-dev/server.json (in ~/.oribot-dev)",
        "~/.oribot-dev/server.json.tmp (in ~/.oribot-dev)",
        "~/.oribot-dev/attachments (in ~/.oribot-dev)",
        "~/.oribot-dev/instructions-drafts (in ~/.oribot-dev)",
        "~/.oribot-dev/plugin-data (in ~/.oribot-dev)",
        "~/.oribot-dev/plugins (in ~/.oribot-dev)",
        "~/.oribot-dev/sign-in (in ~/.oribot-dev)",
        "~/.oribot-dev/skills (in ~/.oribot-dev)",
        "~/.oribot-dev/t3-watch (in ~/.oribot-dev)",
        "~/.oribot-dev/vault.json (in ~/.oribot-dev)",
        "~/.oribot-dev/vault-secrets.json (in ~/.oribot-dev)",
        "~/.oribot-dev/vault.key (in ~/.oribot-dev)",
        "~/.oribot-dev/vault.key.dpapi (in ~/.oribot-dev)",
        "~/.oribot-dev/desktop (in ~/.oribot-dev)",
      ],
      "installed": [
        "~/.oribot/oribot.sqlite (in ~/.oribot)",
        "~/.oribot/oribot.sqlite-wal (in ~/.oribot)",
        "~/.oribot/oribot.sqlite-shm (in ~/.oribot)",
        "~/.oribot/oribot.sqlite-journal (in ~/.oribot)",
        "~/.oribot/host.lock.db (in ~/.oribot)",
        "~/.oribot/host.lock.db-journal (in ~/.oribot)",
        "~/.oribot/host.lock.db-wal (in ~/.oribot)",
        "~/.oribot/host.lock.db-shm (in ~/.oribot)",
        "~/.oribot/launch.json (in ~/.oribot)",
        "~/.oribot/launch.json.tmp (in ~/.oribot)",
        "~/.oribot/server.json (in ~/.oribot)",
        "~/.oribot/server.json.tmp (in ~/.oribot)",
        "~/.oribot/attachments (in ~/.oribot)",
        "~/.oribot/instructions-drafts (in ~/.oribot)",
        "~/.oribot/plugin-data (in ~/.oribot)",
        "~/.oribot/plugins (in ~/.oribot)",
        "~/.oribot/sign-in (in ~/.oribot)",
        "~/.oribot/skills (in ~/.oribot)",
        "~/.oribot/t3-watch (in ~/.oribot)",
        "~/.oribot/vault.json (in ~/.oribot)",
        "~/.oribot/vault-secrets.json (in ~/.oribot)",
        "~/.oribot/vault.key (in ~/.oribot)",
        "~/.oribot/vault.key.dpapi (in ~/.oribot)",
        "~/Library/Application Support/Ori Bot (in ~)",
        "~/Library/Caches/com.legendarykoi.oribot (in ~)",
        "~/Library/Caches/com.legendarykoi.oribot.ShipIt (in ~)",
        "~/Library/Caches/oribot-updater (in ~)",
        "~/Library/HTTPStorages/com.legendarykoi.oribot (in ~)",
        "~/Library/Logs/Ori Bot (in ~)",
        "~/Library/Preferences/com.legendarykoi.oribot.plist (in ~)",
        "~/Library/Saved Application State/com.legendarykoi.oribot.savedState (in ~)",
      ],
    }
  `);
});

it('refuses /, home and its parents, anything outside its root, dotted paths, symbolic links, and anything holding or inside an agent workspace, in any case or Unicode form', () => {
  const ctx = context('installed', `${HOME}/.oribot`, [`${HOME}/code/app`, `${HOME}/.oribot/skills/shared`, `${HOME}/caf\u00e9`]);
  const workspaces = workspacesOf(ctx);
  const data = `${HOME}/.oribot`;
  const check = (target: string, root = data, facts: Parameters<typeof refusalOf>[3] = { kind: 'present', realPath: target }) => refusalOf(target, root, HOME, facts, workspaces);
  expect({
    ok: check(`${data}/attachments`),
    root: check('/', '/'),
    home: check(HOME, HOME),
    homeParent: check('/Users', '/'),
    theRootItself: check(data),
    outsideRoot: check(`${HOME}/Documents`),
    dotted: check(`${data}/../Documents`),
    relative: check('.oribot/attachments'),
    symlink: check(`${data}/plugins`, data, { kind: 'symlink' }),
    throughSymlink: check(`${data}/attachments`, data, { kind: 'present', realPath: '/Volumes/Other/attachments' }),
    dedicatedWorkspaces: check(`${data}/workspaces`),
    insideDedicated: check(`${data}/workspaces/agent-1`),
    holdsSharedWorkspace: check(`${data}/skills`),
    insideOutsideWorkspace: check(`${HOME}/code/app/.oribot`, HOME),
    rootOutsideHome: check('/Applications/Ori Bot.app', '/Applications'),
    dotDotName: check(`${data}/..attachments`),
    holdsOutsideWorkspace: check(`${HOME}/code`, HOME),
    insideWorkspaceOtherCase: check(`${HOME}/CODE/App/.oribot`, HOME),
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
      "home": "Outside Ori Bot's own folders.",
      "homeParent": "Outside Ori Bot's own folders.",
      "insideDedicated": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideOutsideWorkspace": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideWorkspaceOtherCase": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideWorkspaceOtherUnicodeForm": "An agent workspace, or holds one. Workspaces are never touched.",
      "ok": null,
      "outsideRoot": "Outside Ori Bot's own folders.",
      "relative": "Not a plain absolute path.",
      "root": "Outside Ori Bot's own folders.",
      "rootOutsideHome": "Outside Ori Bot's own folders.",
      "symlink": "A symbolic link. Ori Bot does not follow it.",
      "theRootItself": "Outside Ori Bot's own folders.",
      "throughSymlink": "Reached through a symbolic link. Ori Bot does not follow it.",
    }
  `);
});

it('finds Ori Bot.app only as the bundle holding the running binary, inside an Applications folder', () => {
  const exec = (bundle: string) => `${bundle}/Contents/MacOS/Ori Bot`;
  expect({
    system: bundleOf(exec('/Applications/Ori Bot.app'), HOME),
    user: bundleOf(exec(`${HOME}/Applications/Ori Bot.app`), HOME),
    renamed: bundleOf(exec('/Applications/Other.app'), HOME),
    nested: bundleOf(exec('/Applications/Tools/Ori Bot.app'), HOME),
    diskImage: bundleOf(exec('/Volumes/Ori Bot/Ori Bot.app'), HOME),
    translocated: bundleOf(exec('/private/var/folders/x/AppTranslocation/1/d/Ori Bot.app'), HOME),
    devElectron: bundleOf('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', HOME),
    notABundle: bundleOf('/usr/local/bin/node', HOME),
    dotted: bundleOf('/Applications/x/../Ori Bot.app/Contents/MacOS/Ori Bot', HOME),
  }).toMatchInlineSnapshot(`
    {
      "devElectron": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "diskImage": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "dotted": {
        "kind": "refused",
        "reason": "Ori Bot is not running from an app bundle.",
      },
      "nested": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "notABundle": {
        "kind": "refused",
        "reason": "Ori Bot is not running from an app bundle.",
      },
      "renamed": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "system": {
        "kind": "bundle",
        "path": "/Applications/Ori Bot.app",
      },
      "translocated": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Bot.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "user": {
        "kind": "bundle",
        "path": "/Users/tester/Applications/Ori Bot.app",
      },
    }
  `);
  expect([bundleIdIn('<key>CFBundleIdentifier</key>\n    <string>com.legendarykoi.oribot</string>'), bundleIdIn('<key>CFBundleName</key><string>x</string>')]).toEqual(['com.legendarykoi.oribot', null]);
});
