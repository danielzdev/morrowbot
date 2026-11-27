# Plugins

Each plugin is one folder here (`plugins/<name>/`) and an npm workspace. The host
starts every enabled plugin in its own Node process, so a crash cannot take down
the host or other plugins. `--safe-mode` (or `MORROWBOT_SAFE_MODE=1`) starts the
host with no plugin processes at all.

A plugin may import only `@morrowbot/plugin-sdk` and `@morrowbot/contracts`,
plus its own files. `npm run lint` enforces this.

## Shape of a plugin

`manifest.json` describes the plugin; the host reads it without running any plugin code:

```json
{
  "id": "echo",
  "name": "Echo",
  "version": "1.0.0",
  "kind": "provider",
  "main": "src/index.ts",
  "permissions": [],
  "settingsSchema": {
    "greeting": { "kind": "string", "label": "Greeting", "default": "hello" }
  }
}
```

A setting without a `default` must be filled in before the plugin starts. The
plugin process gets only `PATH` from the host's environment, plus any variable
named in the optional `"env"` list (for example `"env": ["HOME"]`). The entry
file serves the plugin over IPC with `runPlugin`:

```ts
import { runPlugin } from '@morrowbot/plugin-sdk';

runPlugin({
  kind: 'provider',
  init: ({ config }) => { /* settings, checked and with defaults */ },
  health: () => ({ kind: 'ok' }),
  stream: async (request, sink) => {
    sink.emit({ kind: 'text', text: 'hello' });
    return 'stop';
  },
});
```

A stream emits `text` deltas, and may also emit `status` lines, `tool-start` and
`tool-end` events, and the `final` reply text. The SDK also gives plugins `z`
(Zod) to parse outside data, and `runCommand` to run a program; aborting its
signal stops the program's whole process group, and commands still running when
the plugin stops are stopped with it.

`provider-claude/` is the first real plugin. Small examples live in
`apps/host/src/features/plugins/fixtures/`.
