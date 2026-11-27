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

## Build MorrowBot.app

```sh
npm run package:mac -w apps/desktop      # Apple Silicon .dmg and .zip in apps/desktop/release
```

Signing, notarization, private releases and auto-updates: [`apps/desktop/RELEASING.md`](apps/desktop/RELEASING.md).

## License

Licensed under the [Apache License 2.0](LICENSE).

Agent avatars are drawn with [open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) by Dominik Scholz (MIT); see [`THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt`](THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt).
