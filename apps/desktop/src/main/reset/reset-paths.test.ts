import { expect, it } from 'vitest';
import { bundleIdIn, bundleOf, dataDirRefusal, deleteCandidatesOf, refusalOf, workspacesOf, type ResetContext } from './reset-paths.ts';

const HOME = '/Users/tester';
const context = (kind: 'installed' | 'isolated', dataDir: string, workspaces: readonly string[] | null = []): ResetContext => ({
  platform: 'darwin',
  homeDir: HOME,
  profile: { kind, dataDir },
  workspaces,
});

it('cleans the data folder only where the profile allows: never ~/.orikami from a development run, never outside home', () => {
  expect({
    installed: dataDirRefusal(context('installed', `${HOME}/.orikami`)),
    installedElsewhere: dataDirRefusal(context('installed', `${HOME}/other`)),
    dev: dataDirRefusal(context('isolated', `${HOME}/.orikami-dev`)),
    customInHome: dataDirRefusal(context('isolated', `${HOME}/try/orikami`)),
    devPointedAtInstalled: dataDirRefusal(context('isolated', `${HOME}/.orikami`)),
    devPointedAtInstalledOtherCase: dataDirRefusal(context('isolated', `${HOME}/.OriKami`)),
    devInsideInstalled: dataDirRefusal(context('isolated', `${HOME}/.orikami/nested`)),
    devHoldingInstalled: dataDirRefusal(context('isolated', HOME)),
    devOutsideHome: dataDirRefusal(context('isolated', '/tmp/screens')),
    devRoot: dataDirRefusal(context('isolated', '/')),
    dotted: dataDirRefusal(context('isolated', `${HOME}/a/../.orikami`)),
  }).toMatchInlineSnapshot(`
    {
      "customInHome": "A development run resets only ~/.orikami-dev. This run uses another folder (ORIKAMI_DATA_DIR); delete it yourself if you no longer need it.",
      "dev": null,
      "devHoldingInstalled": "A development run never resets the installed app's ~/.orikami.",
      "devInsideInstalled": "A development run never resets the installed app's ~/.orikami.",
      "devOutsideHome": "A development run resets only ~/.orikami-dev. This run uses another folder (ORIKAMI_DATA_DIR); delete it yourself if you no longer need it.",
      "devPointedAtInstalled": "A development run never resets the installed app's ~/.orikami.",
      "devPointedAtInstalledOtherCase": "A development run never resets the installed app's ~/.orikami.",
      "devRoot": "A development run never resets the installed app's ~/.orikami.",
      "dotted": "The data folder is not a plain absolute path.",
      "installed": null,
      "installedElsewhere": "The installed app keeps its data only in ~/.orikami.",
    }
  `);
});

it('lists only the entries Ori Kami owns: the installed app adds its Library files, a development run only its own folder', () => {
  const short = (ctx: ResetContext) => deleteCandidatesOf(ctx).map(({ path, root }) => `${path.replace(HOME, '~')} (in ${root.replace(HOME, '~')})`);
  expect({ installed: short(context('installed', `${HOME}/.orikami`)), dev: short(context('isolated', `${HOME}/.orikami-dev`)) }).toMatchInlineSnapshot(`
    {
      "dev": [
        "~/.orikami-dev/orikami.sqlite (in ~/.orikami-dev)",
        "~/.orikami-dev/orikami.sqlite-wal (in ~/.orikami-dev)",
        "~/.orikami-dev/orikami.sqlite-shm (in ~/.orikami-dev)",
        "~/.orikami-dev/orikami.sqlite-journal (in ~/.orikami-dev)",
        "~/.orikami-dev/host.lock.db (in ~/.orikami-dev)",
        "~/.orikami-dev/host.lock.db-journal (in ~/.orikami-dev)",
        "~/.orikami-dev/host.lock.db-wal (in ~/.orikami-dev)",
        "~/.orikami-dev/host.lock.db-shm (in ~/.orikami-dev)",
        "~/.orikami-dev/launch.json (in ~/.orikami-dev)",
        "~/.orikami-dev/launch.json.tmp (in ~/.orikami-dev)",
        "~/.orikami-dev/server.json (in ~/.orikami-dev)",
        "~/.orikami-dev/server.json.tmp (in ~/.orikami-dev)",
        "~/.orikami-dev/attachments (in ~/.orikami-dev)",
        "~/.orikami-dev/instructions-drafts (in ~/.orikami-dev)",
        "~/.orikami-dev/plugin-data (in ~/.orikami-dev)",
        "~/.orikami-dev/plugins (in ~/.orikami-dev)",
        "~/.orikami-dev/sign-in (in ~/.orikami-dev)",
        "~/.orikami-dev/skills (in ~/.orikami-dev)",
        "~/.orikami-dev/t3-watch (in ~/.orikami-dev)",
        "~/.orikami-dev/vault.json (in ~/.orikami-dev)",
        "~/.orikami-dev/vault-secrets.json (in ~/.orikami-dev)",
        "~/.orikami-dev/vault.key (in ~/.orikami-dev)",
        "~/.orikami-dev/vault.key.dpapi (in ~/.orikami-dev)",
        "~/.orikami-dev/desktop (in ~/.orikami-dev)",
      ],
      "installed": [
        "~/.orikami/orikami.sqlite (in ~/.orikami)",
        "~/.orikami/orikami.sqlite-wal (in ~/.orikami)",
        "~/.orikami/orikami.sqlite-shm (in ~/.orikami)",
        "~/.orikami/orikami.sqlite-journal (in ~/.orikami)",
        "~/.orikami/host.lock.db (in ~/.orikami)",
        "~/.orikami/host.lock.db-journal (in ~/.orikami)",
        "~/.orikami/host.lock.db-wal (in ~/.orikami)",
        "~/.orikami/host.lock.db-shm (in ~/.orikami)",
        "~/.orikami/launch.json (in ~/.orikami)",
        "~/.orikami/launch.json.tmp (in ~/.orikami)",
        "~/.orikami/server.json (in ~/.orikami)",
        "~/.orikami/server.json.tmp (in ~/.orikami)",
        "~/.orikami/attachments (in ~/.orikami)",
        "~/.orikami/instructions-drafts (in ~/.orikami)",
        "~/.orikami/plugin-data (in ~/.orikami)",
        "~/.orikami/plugins (in ~/.orikami)",
        "~/.orikami/sign-in (in ~/.orikami)",
        "~/.orikami/skills (in ~/.orikami)",
        "~/.orikami/t3-watch (in ~/.orikami)",
        "~/.orikami/vault.json (in ~/.orikami)",
        "~/.orikami/vault-secrets.json (in ~/.orikami)",
        "~/.orikami/vault.key (in ~/.orikami)",
        "~/.orikami/vault.key.dpapi (in ~/.orikami)",
        "~/Library/Application Support/Ori Kami (in ~)",
        "~/Library/Caches/com.legendarykoi.orikami (in ~)",
        "~/Library/Caches/com.legendarykoi.orikami.ShipIt (in ~)",
        "~/Library/Caches/orikami-updater (in ~)",
        "~/Library/HTTPStorages/com.legendarykoi.orikami (in ~)",
        "~/Library/Logs/Ori Kami (in ~)",
        "~/Library/Preferences/com.legendarykoi.orikami.plist (in ~)",
        "~/Library/Saved Application State/com.legendarykoi.orikami.savedState (in ~)",
      ],
    }
  `);
});

it('refuses /, home and its parents, anything outside its root, dotted paths, symbolic links, and anything holding or inside an agent workspace, in any case or Unicode form', () => {
  const ctx = context('installed', `${HOME}/.orikami`, [`${HOME}/code/app`, `${HOME}/.orikami/skills/shared`, `${HOME}/caf\u00e9`]);
  const workspaces = workspacesOf(ctx);
  const data = `${HOME}/.orikami`;
  const check = (target: string, root = data, facts: Parameters<typeof refusalOf>[3] = { kind: 'present', realPath: target }) => refusalOf(target, root, HOME, facts, workspaces);
  expect({
    ok: check(`${data}/attachments`),
    root: check('/', '/'),
    home: check(HOME, HOME),
    homeParent: check('/Users', '/'),
    theRootItself: check(data),
    outsideRoot: check(`${HOME}/Documents`),
    dotted: check(`${data}/../Documents`),
    relative: check('.orikami/attachments'),
    symlink: check(`${data}/plugins`, data, { kind: 'symlink' }),
    throughSymlink: check(`${data}/attachments`, data, { kind: 'present', realPath: '/Volumes/Other/attachments' }),
    dedicatedWorkspaces: check(`${data}/workspaces`),
    insideDedicated: check(`${data}/workspaces/agent-1`),
    holdsSharedWorkspace: check(`${data}/skills`),
    insideOutsideWorkspace: check(`${HOME}/code/app/.orikami`, HOME),
    rootOutsideHome: check('/Applications/Ori Kami.app', '/Applications'),
    dotDotName: check(`${data}/..attachments`),
    holdsOutsideWorkspace: check(`${HOME}/code`, HOME),
    insideWorkspaceOtherCase: check(`${HOME}/CODE/App/.orikami`, HOME),
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
      "home": "Outside Ori Kami's own folders.",
      "homeParent": "Outside Ori Kami's own folders.",
      "insideDedicated": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideOutsideWorkspace": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideWorkspaceOtherCase": "An agent workspace, or holds one. Workspaces are never touched.",
      "insideWorkspaceOtherUnicodeForm": "An agent workspace, or holds one. Workspaces are never touched.",
      "ok": null,
      "outsideRoot": "Outside Ori Kami's own folders.",
      "relative": "Not a plain absolute path.",
      "root": "Outside Ori Kami's own folders.",
      "rootOutsideHome": "Outside Ori Kami's own folders.",
      "symlink": "A symbolic link. Ori Kami does not follow it.",
      "theRootItself": "Outside Ori Kami's own folders.",
      "throughSymlink": "Reached through a symbolic link. Ori Kami does not follow it.",
    }
  `);
});

it('finds Ori Kami.app only as the bundle holding the running binary, inside an Applications folder', () => {
  const exec = (bundle: string) => `${bundle}/Contents/MacOS/Ori Kami`;
  expect({
    system: bundleOf(exec('/Applications/Ori Kami.app'), HOME),
    user: bundleOf(exec(`${HOME}/Applications/Ori Kami.app`), HOME),
    renamed: bundleOf(exec('/Applications/Other.app'), HOME),
    nested: bundleOf(exec('/Applications/Tools/Ori Kami.app'), HOME),
    diskImage: bundleOf(exec('/Volumes/Ori Kami/Ori Kami.app'), HOME),
    translocated: bundleOf(exec('/private/var/folders/x/AppTranslocation/1/d/Ori Kami.app'), HOME),
    devElectron: bundleOf('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', HOME),
    notABundle: bundleOf('/usr/local/bin/node', HOME),
    dotted: bundleOf('/Applications/x/../Ori Kami.app/Contents/MacOS/Ori Kami', HOME),
  }).toMatchInlineSnapshot(`
    {
      "devElectron": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "diskImage": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "dotted": {
        "kind": "refused",
        "reason": "Ori Kami is not running from an app bundle.",
      },
      "nested": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "notABundle": {
        "kind": "refused",
        "reason": "Ori Kami is not running from an app bundle.",
      },
      "renamed": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "system": {
        "kind": "bundle",
        "path": "/Applications/Ori Kami.app",
      },
      "translocated": {
        "kind": "refused",
        "reason": "Uninstalling works only for Ori Kami.app in Applications. Move it there, or drag it to the Trash yourself.",
      },
      "user": {
        "kind": "bundle",
        "path": "/Users/tester/Applications/Ori Kami.app",
      },
    }
  `);
  expect([bundleIdIn('<key>CFBundleIdentifier</key>\n    <string>com.legendarykoi.orikami</string>'), bundleIdIn('<key>CFBundleName</key><string>x</string>')]).toEqual(['com.legendarykoi.orikami', null]);
});
