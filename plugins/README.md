# Plugins

Each plugin is one folder here (`plugins/<name>/`) and an npm workspace. A plugin
runs in its own isolated worker process, so a crash cannot take down the host.

A plugin may import only `@morrowbot/plugin-sdk` and `@morrowbot/contracts`,
plus its own files. `npm run lint` enforces this.
