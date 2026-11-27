# MorrowBot

An open-source, plugin-first personal AI agent app built on a small TypeScript/Electron core and free, open-source plugins.

> **Status:** Early bootstrap (pre-v0.1). Repository workflow and architecture foundations are in place; Milestone 1 development is starting next.

## Run the desktop app

```sh
npm ci
node node_modules/electron/install.js   # once: downloads the Electron binary
npm start -w apps/desktop               # builds the window, then starts Electron and the host
```

Data lives in `~/.morrowbot` (`MORROWBOT_DATA_DIR` moves it). The Claude, Codex and Antigravity providers are built in; other plugins load from its `plugins` folder (`MORROWBOT_PLUGINS_DIR`).

By default the host listens only on `127.0.0.1`. To let a paired phone reach it over Tailscale or your LAN, set `MORROWBOT_HOST_BIND` to that interface's address (for example your Tailscale `100.x.y.z`). Every route needs the desktop's token or a paired device's token, except the rate-limited pairing claim a phone uses to trade a one-time code for its token. Unpairing a device cuts it off at once. Prefer the Tailscale address: the host speaks plain HTTP, so on an ordinary LAN the pairing code and device tokens cross the network unencrypted.

## License

Licensed under the [Apache License 2.0](LICENSE).

Agent avatars are drawn with [open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) by Dominik Scholz (MIT); see [`THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt`](THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt).
