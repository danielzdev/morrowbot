# MorrowBot

An open-source, plugin-first personal AI agent app built on a small TypeScript/Electron core and free, open-source plugins.

> **Status:** Early bootstrap (pre-v0.1). Repository workflow and architecture foundations are in place; Milestone 1 development is starting next.

## Run the desktop app

```sh
npm ci
node node_modules/electron/install.js   # once: downloads the Electron binary
npm start -w apps/desktop               # builds the window, then starts Electron and the host
```

Data lives in `~/.morrowbot` (`MORROWBOT_DATA_DIR` moves it); plugins load from its `plugins` folder (`MORROWBOT_PLUGINS_DIR`).

## License

Licensed under the [Apache License 2.0](LICENSE).
