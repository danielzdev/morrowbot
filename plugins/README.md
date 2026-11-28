# Plugins

Each plugin is one folder here (`plugins/<name>/`) and an npm workspace. The host
starts every enabled plugin in its own Node process, so a crash cannot take down
the host or other plugins. `--safe-mode` (or `MORROWBOT_SAFE_MODE=1`) starts the
host with no plugin processes; the built-in providers still run, so chat keeps working.

This folder ships inside the app as its built-in plugins folder
(`MORROWBOT_BUILTIN_PLUGINS_DIR`); the user's own plugins live in `~/.morrowbot/plugins`.
Both are read on every launch and by Rescan in Extensions. A built-in id wins over the user's.

The Claude, Codex, Antigravity and OpenCode providers are not plugin folders: they are built into the host
(`packages/providers`). They speak the same protocol through the same SDK runtime,
but run inside the host process with no worker, so they work with no plugins folder.
A plugin folder that reuses a built-in id (`provider-claude`, `provider-openai`, `provider-antigravity`, `provider-opencode`) is
skipped and reported as a problem.

A plugin may import only `@morrowbot/plugin-sdk` and `@morrowbot/contracts`,
plus its own files. `npm run lint` enforces this.

## Shape of a plugin

`manifest.json` describes the plugin; the host reads it without running any plugin code:

```json
{
  "protocolVersion": 1,
  "id": "echo",
  "name": "Echo",
  "version": "1.0.0",
  "kind": "provider",
  "main": "src/index.ts",
  "permissions": [],
  "envPreset": "none",
  "settingsSchema": {
    "greeting": { "kind": "string", "label": "Greeting", "default": "hello" }
  }
}
```

A setting without a `default` must be filled in before the plugin starts. The
plugin process gets `PATH` (the user's login-shell `PATH`) and nothing else from
the host's environment with `envPreset: "none"`. A plugin that runs a vendor CLI
uses `"cli-runtime"`, which adds what such CLIs need (`HOME`, `USER`, `LANG`,
`TMPDIR`, the `XDG_*` folders, proxy settings and the like). This keeps the host's
environment out of plugins by default; it is not a sandbox, since plugins are
trusted code. Each plugin also gets its own data folder (`init`'s `dataDir`).

A provider's entry file serves it over IPC with `defineProvider` and `runPlugin`.
`runPlugin` takes a factory that builds the plugin on its `runtime` (a breaking
change before 1.0: `runPlugin(plugin)` and the SDK's free `openCommand`,
`runCommand`, `jsonRpcProcess`, `statExecutable` and `readCliVersion` are gone):

```ts
import { defineProvider, runPlugin } from '@morrowbot/plugin-sdk';

runPlugin((runtime) =>
  defineProvider({
    init: ({ config }) => { /* settings, checked and with defaults */ },
    providerInfo: () => ({ kind: 'ready', /* version, accountKey, capabilities, models */ }),
    usage: () => ({ kind: 'unavailable', observedAt: new Date().toISOString(), accountKey: '', reason: 'unsupported' }),
    routeInfo: () => ({ kind: 'known', accountKey: '', routeKey: '' }),
    turn: async ({ request, signal, emit }) => {
      emit({ kind: 'text', text: 'hello' });
      return { outcome: { kind: 'completed', finishReason: 'stop' }, usage: { kind: 'unavailable' },
        actualModel: null, accountKey: request.expectedAccountKey, sessionTouched: true, finalText: null };
    },
  }),
);
```

`providerInfo` says whether the vendor runtime is installed, signed in and which
access profiles it offers (or withholds, and why). A turn streams `text` deltas,
and may also emit `status` lines, `tool-start`/`tool-end`, `session-bound` and
`usage-update`; it ends with one `TurnEnd`. The contract is in
`packages/contracts/src/provider.ts` and `plugin-rpc.ts`.

The runtime gives a plugin its environment (`runtime.env`, read `HOME` and the like
there, never from `process.env`), its OS (`runtime.platform`), `openCommand` and
`runCommand` to run a program, `jsonRpcProcess` to talk JSON-RPC 2.0 over a
long-lived program's stdin and stdout (requests, replies, notifications and the
program's own requests, each request with a timeout), `statExecutable` and
`readCliVersion`. The SDK also exports `z` (Zod) to parse outside data,
`readOptionalFile`, `listDirectory`, `checkVersion` and `confinePath`. Each program
runs under a small guard process that leads its own process group. The host records
the group before the program starts and treats the thread as busy until the group is
confirmed gone. Stop ends the whole group (SIGTERM, then SIGKILL a second later);
anything the program leaves in the group is killed when it exits; and the group is
killed if the plugin process dies, even by SIGKILL (or, for a built-in provider,
when the host ends it). Processes that move to a group
of their own are out of its reach. `openCommand` needs macOS or Linux; provider
plugins are disabled on Windows for now.

The built-in `packages/providers/src/claude/` runs Claude Code once per turn;
`packages/providers/src/openai/` runs one shared Codex `app-server` daemon
(`openCommand` with `scope: {kind: 'daemon'}`), and `packages/providers/src/antigravity/` and
`packages/providers/src/opencode/` one shared `agy acp` and `opencode acp` daemon each.

Both ACP providers talk through the SDK's `acp` namespace: `acp.startAcpClient` starts an Agent
Client Protocol (v1) agent as the shared daemon, completes `initialize`, routes each session's
updates and permission requests to the turn that holds it, and is read-only by construction. It
offers the agent no file or terminal access, and a tripwire hears every session: an edit, command or
mode switch the agent reports finished without asking ends the agent at once. `acp.decide` and
`acp.permissionResult` are the read-only permission policy (reads, searches and fetches go to a
card; everything else is denied), and `acp.createSessionStream` turns updates into turn chunks.
A command or daemon may add its own variables with `env`. Small plugin examples live in
`apps/host/src/features/plugins/fixtures/`.
