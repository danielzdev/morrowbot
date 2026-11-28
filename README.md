# MorrowBot

An open-source, plugin-first personal AI agent app built on a small TypeScript/Electron core and free, open-source plugins.

> **Status:** Early bootstrap (pre-v0.1). Repository workflow and architecture foundations are in place; Milestone 1 development is starting next.

## Run the desktop app

```sh
npm ci
node node_modules/electron/install.js   # once: downloads the Electron binary
npm start -w apps/desktop               # builds the window, then starts Electron and the host
```

A dev run keeps its data in `~/.morrowbot-dev` (`MORROWBOT_DATA_DIR` moves it); only the installed `MorrowBot.app` uses `~/.morrowbot`. The Claude, Codex, Antigravity and OpenCode providers are built in; other plugins load from the data folder's `plugins` folder (`MORROWBOT_PLUGINS_DIR`).

On macOS, vault secrets are kept in the login Keychain rather than the data folder, so deleting the folder leaves them behind: delete each item in Settings › Vault before deleting the folder, or remove the `com.legendarykoi.morrowbot.vault` items in Keychain Access afterwards.

## Build MorrowBot.app

```sh
npm run package:mac -w apps/desktop      # Apple Silicon .dmg and .zip in apps/desktop/release
```

Signing, notarization, private releases and auto-updates: [`apps/desktop/RELEASING.md`](apps/desktop/RELEASING.md).

By default the host listens only on `127.0.0.1`. To let a paired phone reach it over Tailscale or your LAN, set `MORROWBOT_HOST_BIND` to that interface's address (for example your Tailscale `100.x.y.z`). Every route needs the desktop's token or a paired device's token, except the rate-limited pairing claim a phone uses to trade a one-time code for its token. Unpairing a device cuts it off at once. Prefer the Tailscale address: the host speaks plain HTTP, so on an ordinary LAN the pairing code and device tokens cross the network unencrypted.

## Browser extension

Agents can drive your Chromium browser (Chrome, Brave, Edge, Arc, Dia...) through the built-in Browser plugin and the MorrowBot extension. Build, load and pairing steps: [`apps/browser-extension/README.md`](apps/browser-extension/README.md).

## License

Licensed under the [Apache License 2.0](LICENSE).

Agent avatars are drawn with [open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) by Dominik Scholz (MIT); see [`THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt`](THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt).
