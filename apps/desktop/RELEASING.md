# Packaging and releasing MorrowBot.app

## Which data a run opens

| Run | Data folder | Electron profile and single-instance lock | Host port |
|---|---|---|---|
| Installed `MorrowBot.app` | `~/.morrowbot` | Electron's own (`~/Library/Application Support/MorrowBot`) | 47800 |
| `npm start -w apps/desktop`, tests, screenshots | `~/.morrowbot-dev` | `~/.morrowbot-dev/desktop` | free port |
| Any run with `MORROWBOT_DATA_DIR=/abs/path` | that folder | `<folder>/desktop` | free port |

So a dev run can stay open beside the installed app without sharing its chats, settings, lock or port.
A host started by hand (`npm start -w apps/host`) also defaults to `~/.morrowbot-dev` and a free port.
`MORROWBOT_HOST_PORT` sets the port for any run; set it when pairing a device with a dev host, so the
paired address survives a restart. Only the installed app checks for updates.
`src/main/profile.ts` decides this, and `src/main/profile.test.ts` records it.

## Reset or Uninstall (Settings › About)

The installed app offers three choices: reset and relaunch, move `MorrowBot.app` to the Trash, or both
plus all data. A development run may only reset `~/.morrowbot-dev` (never a custom `MORROWBOT_DATA_DIR`);
it never touches `~/.morrowbot`, `MorrowBot.app`, Library files or the Keychain. Only MorrowBot's own entries
in the data folder, its Library files and its Keychain items are removed; `workspaces/`, any agent
workspace, symbolic links, unreadable paths and unknown files stay. Reset keeps the release feed token;
Full uninstall removes it. The confirmation lists every path first. Deletion runs in a helper after the
app exits (log: `$TMPDIR/morrowbot-reset.log`); while it runs, MorrowBot refuses to start. The allowlist
lives in `src/main/reset/reset-paths.ts`.

## Build the app locally

```sh
npm ci
npm run package:mac -w apps/desktop
open apps/desktop/release/mac-arm64/MorrowBot.app
```

This writes `release/MorrowBot-<version>-arm64.dmg`, the `.zip` and `latest-mac.yml`.
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

The releases repo is `danielzdev/morrowbot-releases`. A repository variable `MORROWBOT_RELEASES_REPO`
(`owner/repo`) publishes somewhere else; the build then also updates from there.

## Updates in the installed app

Drag MorrowBot into `/Applications` first: macOS cannot update an app run from the mounted `.dmg` or from
`~/Downloads`.

The installed app checks 15 seconds after launch and every 4 hours, downloads in the background, shows
"Update ready" with **Restart to update** once macOS has staged the update, and otherwise installs on the
next quit. Settings › About has **Check for updates**.

While the releases repo is private, the app needs a token that can read it (a fine-grained token with
**Contents: Read** on the releases repo). Store it in the login Keychain; each check reads it again, so a new
or rotated token needs no restart:

```sh
security add-generic-password -s com.legendarykoi.morrowbot.releases -a releases -w
```

`MORROWBOT_RELEASES_TOKEN` overrides the Keychain token, and `MORROWBOT_RELEASES_REPO` the repo, for one run.
