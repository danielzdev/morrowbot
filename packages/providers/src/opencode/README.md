# OpenCode (free models)

A provider built into MorrowBot that answers with the `opencode` CLI and its free models, which
need no account or sign-in. It runs one shared daemon,

```
opencode acp
```

speaking the Agent Client Protocol (ACP v1) through the SDK's read-only ACP client
(`acp.startAcpClient`, shared with Antigravity). Provider-info starts it and registers it with the
host before any turn uses it.

**MorrowBot's own opencode.** The daemon gets its own home, config, data, state and cache folders
under the provider's data folder (`HOME`, `XDG_*`), so it reads none of your opencode settings,
plugins, MCP servers, skills (`~/.agents`, `~/.opencode`) or sign-ins, and your
`~/.local/share/opencode` sessions are untouched. It runs with `OPENCODE_DISABLE_PROJECT_CONFIG`
(no `opencode.json`, `.opencode/`, plugins, MCP servers or top-level `AGENTS.md` from the
workspace), `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_EXTERNAL_SKILLS` and
`OPENCODE_DISABLE_AUTOUPDATE`, and with a read-only config in `OPENCODE_CONFIG_CONTENT`
(`config.ts`, checked on opencode 2.4.1).

**Turns.** Each turn opens a new ACP session (`session/new`) in the agent's workspace, sets the
picked model (`session/set_config_option`), checks it runs in the `build` mode, and sends
`session/prompt`; the session is closed at the end. opencode reports no account, so the account
key is `''`: every turn is stateless, and the host seeds it with the conversation
(`capabilities.sessions` is false). As opencode loads no workspace config, the agent's `AGENTS.md`
comes from MorrowBot (`isolated`), sent ahead of the prompt in an `<instructions>` block. One
exception opencode 2.4.1 has no switch for: after reading a file, it adds any `AGENTS.md` in the
folders between that file and the workspace root to the model's context, as workspace content
(it follows a symlink to the file first, so the link's target decides where it looks). Stop
sends `session/cancel`. If opencode ignores it, the host ends the daemon and the next turn gets a
new one. opencode 2.4.1 starts a helper, `opencode serve --stdio`, in a process group of its own,
out of the guard's reach; it ends when the daemon's pipe to it closes, even after a SIGKILL (the
live check confirms no process is left).

**Access.** One profile: read-only, interactive, `isolated`:

- every tool is denied in opencode's own config except reads, searches, listings and web fetch, so
  opencode never offers the model a write, edit, shell or task tool (it offers `skill`, which is
  denied and finds none). Web and code search are denied. The other built-in agents (`plan`,
  `general`, `explore`) are disabled, and so are language servers and formatters;
- a read outside the workspace, an `.env` file, or a web fetch asks first: an approval card,
  "Allow once" or "Deny". `allow_always` is never chosen. Anything else opencode asks for is
  denied without a card. opencode ends its reply when a request is denied; the turn still completes;
- the card shows only when opencode asks, and it decides what is outside by the path as written:
  a symlink inside the workspace is read without asking, the whole git repository holding the
  workspace counts as inside, and `grep` searches `.env` files. So the profile declares
  `readsOutsideCwd`; read-only here means nothing is written and nothing is run;
- requests from opencode to write a file or run a terminal through MorrowBot are refused;
- if opencode reports an edit or command that finished without asking, in any session on the
  daemon, or a session leaves the `build` mode, every turn on the daemon fails at once
  (`access-not-supported`), the daemon ends, and the profile is withheld until the provider restarts;
- the profile is withheld while this computer has managed opencode config (an entry in
  `/Library/Application Support/opencode`, or `ai.opencode.managed.plist` in
  `/Library/Managed Preferences` or any user's folder in it), which outranks MorrowBot's own. It is checked by provider-info
  and before every turn.

**Held back** (shown on the Plugins page): workspace-write (opencode runs commands outside any
sandbox), `personal` instructions (they would need opencode's workspace config, which also runs the
workspace's plugins and MCP servers), background turns (a read outside the workspace needs a card),
other systems than macOS, and opencode outside `>=2.4.1 <2.5.0`.

**Usage.** None: quota is `unsupported`. Tokens per turn come from the `session/prompt` result.

Settings:

- **OpenCode CLI path**: `opencode` (found on `PATH`) or a full path.

**Fixtures.** `fixtures/2.4.1/` holds redacted real ACP traffic under MorrowBot's config:
`initialize`, a `session/new` reply with the free models, and four prompts (a reply, a read inside
the workspace, a denied read outside it, and a request to write and run a command that opencode,
offered neither tool, answers in text). `session-replay.test.ts` replays them. The host tests run
`apps/host/src/features/providers/fixtures/fake-opencode.ts`. With `MORROWBOT_LIVE_OPENCODE=1` (and
`MORROWBOT_OPENCODE_PATH`), `provider-opencode-live.test.ts` runs the checks on your real opencode.
