# Ori Bot

An open-source, plugin-first personal AI agent app built on a small TypeScript/Electron core and free, open-source plugins.

> **Status:** Active pre-1.0 self-hosting builds (`apps/desktop`, `apps/host`, `apps/mobile`, `apps/browser-extension`, `plugins/`). Core desktop, always-on host, built-in providers, Vault, connectors, Browser/Computer Use plugins, routines, sub-agents, and Tailscale multi-device pairing are implemented and shipping via signed macOS releases.

## Documentation

- [`AGENTS.md`](AGENTS.md) — coding standards, architecture boundaries, testing philosophy, and git/PR rules
- [`docs/decisions.md`](docs/decisions.md) — settled product, visual, security, and workflow decisions
- [`docs/setup.md`](docs/setup.md) — setting up built-in AI engines (Claude, Codex, Antigravity, OpenCode)
- [`docs/t3-watch-runbook.md`](docs/t3-watch-runbook.md) — driving and watching T3 Code threads from an orchestrator agent
- [`apps/desktop/RELEASING.md`](apps/desktop/RELEASING.md) — local packaging, signing, notarization, private releases, and Reset/Uninstall
- [`apps/mobile/README.md`](apps/mobile/README.md) — Expo iOS companion app
- [`GLOSSARY.md`](GLOSSARY.md) — plain-English project terms

## Run the desktop app

```sh
npm ci
node node_modules/electron/install.js   # once: downloads the Electron binary
npm start -w apps/desktop               # builds the window, then starts Electron and the host
```

A dev run keeps its data in `~/.oribot-dev` (`ORIBOT_DATA_DIR` moves it); only the installed `Ori Bot.app` uses `~/.oribot`. The Claude, Codex, Antigravity and OpenCode providers are built in; other plugins load from the data folder's `plugins` folder (`ORIBOT_PLUGINS_DIR`).

Vault secrets are sealed in the data folder's `vault-secrets.json` under one master key kept in the OS keystore. Deleting the folder removes the secrets; the key itself stays behind as one `com.legendarykoi.oribot.vault` / `master-key` entry in Keychain Access on macOS (shared by every data folder), or in the Secret Service on Linux (one per data folder), which you can delete there.

## Build Ori Bot.app

```sh
npm run package:mac -w apps/desktop      # Apple Silicon .dmg and .zip in apps/desktop/release
```

Signing, notarization, private releases and auto-updates: [`apps/desktop/RELEASING.md`](apps/desktop/RELEASING.md).

By default the host listens only on `127.0.0.1`. To let a paired phone reach it over Tailscale or your LAN, set `ORIBOT_HOST_BIND` to that interface's address (for example your Tailscale `100.x.y.z`). Every route needs the desktop's token or a paired device's token, except the rate-limited pairing claim a phone uses to trade a one-time code for its token. Unpairing a device cuts it off at once. Prefer the Tailscale address: the host speaks plain HTTP, so on an ordinary LAN the pairing code and device tokens cross the network unencrypted.

## Browser extension

Agents can drive your Chromium browser (Chrome, Brave, Edge, Arc, Dia...) through the built-in Browser plugin and the Ori Bot extension. Build, load and pairing steps: [`apps/browser-extension/README.md`](apps/browser-extension/README.md).

## License

Licensed under the [Apache License 2.0](LICENSE).

Agent avatars are drawn with [open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) by Dominik Scholz (MIT); see [`THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt`](THIRD_PARTY_LICENSES/open-bot-avatar-MIT.txt).
