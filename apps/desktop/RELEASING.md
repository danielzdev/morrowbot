# Packaging and releasing Ori Bot.app

## Which data a run opens

| Run | Data folder | Electron profile and single-instance lock | Host port |
|---|---|---|---|
| Installed `Ori Bot.app` | `~/.oribot` | Electron's own (`~/Library/Application Support/Ori Bot`) | 47800 |
| `npm start -w apps/desktop`, tests, screenshots | `~/.oribot-dev` | `~/.oribot-dev/desktop` | free port |
| Any run with `ORIBOT_DATA_DIR=/abs/path` | that folder | `<folder>/desktop` | free port |

So a dev run can stay open beside the installed app without sharing its chats, settings, lock or port.
A host started by hand (`npm start -w apps/host`) also defaults to `~/.oribot-dev` and a free port.
`ORIBOT_HOST_PORT` sets the port for any run; set it when pairing a device with a dev host, so the
paired address survives a restart. Only the installed app checks for updates.
`src/main/profile.ts` decides this, and `src/main/profile.test.ts` records it.

## Reset or Uninstall (Settings › About)

The installed app offers three choices: reset and relaunch, move `Ori Bot.app` to the Trash, or both
plus all data. A development run may only reset `~/.oribot-dev` (never a custom `ORIBOT_DATA_DIR`);
it never touches `~/.oribot`, `Ori Bot.app`, Library files or the Keychain. Only Ori Bot's own entries
in the data folder, its Library files and its Keychain items are removed; `workspaces/`, any agent
workspace, symbolic links, unreadable paths and unknown files stay. Reset keeps the release feed token;
Full uninstall removes it. The confirmation lists every path first. Deletion runs in a helper after the
app exits (log: `$TMPDIR/oribot-reset.log`); while it runs, Ori Bot refuses to start. The allowlist
lives in `src/main/reset/reset-paths.ts`.

## Build the app locally

```sh
npm ci
npm run package:mac -w apps/desktop
open "apps/desktop/release/mac-arm64/Ori Bot.app"
```

This writes `release/OriBot-<version>-arm64.dmg`, the `.zip` and `latest-mac.yml`.
`scripts/build-app.ts` bundles Electron main, the host and the renderer into `dist/app/`, so the app
ships no `node_modules`. It also copies `LICENSE`, `THIRD_PARTY_LICENSES/` and a `THIRD_PARTY_NOTICES.txt`
with the licence of every bundled package.

With no Developer ID certificate in the login Keychain, the app is left unsigned: it runs on the Mac
that built it, but it cannot update itself. To sign and notarize locally, set the same values the
release workflow uses:

| Variable | Value |
|---|---|
| `CSC_LINK` | the Developer ID Application `.p12` (a path, or its base64) |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | the Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password for `notarytool` |
| `APPLE_TEAM_ID` | the 10-character team ID |

electron-builder signs when it finds the certificate and notarizes when the three `APPLE_*` values are set.

## Private releases

`.github/workflows/private-release.yml` runs on every push to `main` (and by hand). It versions the build
`<major>.<minor>.<run number>` from `apps/desktop/package.json`, then builds, signs, notarizes and publishes the
`.dmg`, `.zip` and `latest-mac.yml` to a draft GitHub release of the releases repo, and publishes it only once
every file is uploaded. PR and `main` CI already run `npm run check`; this workflow releases only from `main` and skips itself when any
secret is missing, so forks never fail.

Repository secrets (Settings › Secrets and variables › Actions):

| Secret | Value |
|---|---|
| `APPLE_CERT_BASE64` | base64 of the Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERT_PASSWORD` | the `.p12` password |
| `APPLE_ID` | the Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password for `notarytool` |
| `APPLE_TEAM_ID` | the 10-character team ID |
| `PRIVATE_RELEASES_TOKEN` | a fine-grained token with **Contents: Read and write** on the releases repo |

The releases repo is `danielzdev/ori-bot-releases`. A repository variable `ORIBOT_RELEASES_REPO`
(`owner/repo`) publishes somewhere else; the build then also updates from there.

## Updates in the installed app

Drag Ori Bot into `/Applications` first: macOS cannot update an app run from the mounted `.dmg` or from
`~/Downloads`.

The installed app checks 15 seconds after launch and every 4 hours, downloads in the background, shows
"Update ready" with **Restart to update** once macOS has staged the update, and otherwise installs on the
next quit. Settings › About has **Check for updates**.

While the releases repo is private, the app needs a token that can read it (a fine-grained token with
**Contents: Read** on the releases repo). Store it in the login Keychain; each check reads it again, so a new
or rotated token needs no restart:

```sh
security add-generic-password -s com.legendarykoi.oribot.releases -a releases -w
```

`ORIBOT_RELEASES_TOKEN` overrides the Keychain token, and `ORIBOT_RELEASES_REPO` the repo, for one run.

## Moving from Ori Kami or MorrowBot

The app was called Ori Kami (`com.legendarykoi.orikami`), and before that MorrowBot (`com.legendarykoi.morrowbot`).
Ori Bot is a new app to macOS: a new bundle id, data folder (`~/.oribot`), Electron profile and Keychain items,
and nothing is carried over or migrated. An installed `Ori Kami.app` or `MorrowBot.app` cannot update itself into
`Ori Bot.app`, because the bundle id differs: it keeps downloading each new release and failing to install it until
it is removed.

1. In the old app, Settings › About › **Reset or Uninstall…** › **Full uninstall** removes the app, its data folder
   (`~/.orikami` or `~/.morrowbot`), its Library files and its Keychain items. Do this rather than keeping the old
   data: the fence hides only Ori Bot's own data folder, so a kept `~/.orikami`, `~/.orikami-dev`, `~/.morrowbot`
   or `~/.morrowbot-dev` (chats, vault files, joined-server token) and the `com.legendarykoi.orikami.vault` or
   `com.legendarykoi.morrowbot.vault` Keychain item stay readable by full-access agents. Delete any you keep, and
   `Ori Kami Safe Storage` or `MorrowBot Safe Storage` in Keychain Access if it is still there.
2. Install `Ori Bot.app` from the releases repo's latest `.dmg` and drag it into `/Applications`.
3. Store the release feed token again under the new name:
   `security add-generic-password -s com.legendarykoi.oribot.releases -a releases -w`.
   The old `com.legendarykoi.orikami.releases` or `com.legendarykoi.morrowbot.releases` item can then be deleted in
   Keychain Access.

The `ORIKAMI_*` and `MORROWBOT_*` environment variables are now `ORIBOT_*`, including the `ORIBOT_RELEASES_REPO`
repository variable, and an agent's own skills folder is now `.oribot/skills` in its workspace; the old names are
ignored.
