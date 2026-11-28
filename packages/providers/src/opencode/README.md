# OpenCode (free models)

A provider built into Ori Kami that answers with the `opencode` CLI and its free models, which
need no account or sign-in. It runs one shared daemon,

```
opencode acp
```

speaking the Agent Client Protocol (ACP v1) through the SDK's read-only ACP client
(`acp.startAcpClient`, shared with Antigravity). Provider-info starts it and registers it with the
host before any turn uses it.

**Ori Kami's own opencode.** The daemon gets its own home, config, data, state and cache folders
under the provider's data folder (`HOME`, `XDG_*`), so it reads none of your opencode settings,
plugins, MCP servers, skills (`~/.agents`, `~/.opencode`) or sign-ins, and your
`~/.local/share/opencode` sessions are untouched. It runs with `OPENCODE_DISABLE_PROJECT_CONFIG`
(no `opencode.json`, `.opencode/`, plugins, MCP servers or top-level `AGENTS.md` from the
workspace), `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_EXTERNAL_SKILLS` and
`OPENCODE_DISABLE_AUTOUPDATE`, and with a read-only config in `OPENCODE_CONFIG_CONTENT`
(`config.ts`, checked on opencode 2.4.1).

**Ori Kami's tools.** opencode 2.4.1 connects to MCP servers over HTTP
(`mcpCapabilities.http`), so each session opens with the host's MCP server for that turn and no
other, and the read-only config allows its tools (`orikami_*`). Checked against the fake
daemon only: the real opencode has not run them yet.

**Turns.** Each turn opens a new ACP session (`session/new`) in the agent's workspace, sets the
picked model (`session/set_config_option`), checks it runs in the `build` mode, and sends
`session/prompt`; the session is closed at the end. opencode reports no account, so the account
key is `''`: every turn is stateless, and the host seeds it with the conversation
(`capabilities.sessions` is false). As opencode loads no workspace config, the agent's `SOUL.md`
comes from Ori Kami (`isolated`), sent ahead of the prompt in an `<instructions>` block. One
exception opencode 2.4.1 has no switch for: after reading a file, it adds any `AGENTS.md` in the
folders between that file and the workspace root to the model's context, as workspace content
(it follows a symlink to the file first, so the link's target decides where it looks). Stop
sends `session/cancel`. If opencode ignores it, the host ends the daemon and the next turn gets a
new one. opencode 2.4.1 starts a helper, `opencode serve --stdio`, in a process group of its own,
out of the guard's reach; it ends when the daemon's pipe to it closes, even after a SIGKILL (the
live check confirms no process is left).

**Access.** Two profiles, both `isolated`:

- **read-only** (interactive only): runs in `build` mode where every tool is denied in opencode's
  top-level config except reads, searches, listings, web fetch, and Ori Kami's MCP server, so
  opencode never offers the model a write, edit, shell or task tool (it offers `skill`, which is
  denied and finds none). Web and code search are denied. The other built-in agents (`plan`,
  `general`, `explore`) are disabled, and so are language servers and formatters. A read outside
  the workspace, an `.env` file, or a web fetch asks first via an approval card ("Allow once" or
  "Deny"; `allow_always` is never chosen); anything else is denied without a card. If opencode
  reports an edit or command that finished without asking in a read-only session, or a read-only
  session leaves `build` mode, every turn fails at once (`access-not-supported`), the daemon ends,
  and profiles are withheld until the provider restarts.
- **full** (interactive and background): switches the session to Ori Kami's `full` primary agent
  defined in `OPENCODE_CONFIG_CONTENT` (`permission: { '*': 'allow' }`), skips the read-only
  tripwire for that session, and auto-allows permission prompts without showing cards. Because the
  shared daemon runs with Ori Kami's isolated `HOME` (`<dataDir>/opencode/home`), shell commands
  in full mode see that `HOME` rather than the user's own `~/.gitconfig` or `~/.ssh`. Stop cancels
  the active turn best-effort via `session/cancel`.

Both profiles declare `readsOutsideCwd` and are withheld while this computer has managed opencode
config (an entry in `/Library/Application Support/opencode`, or `ai.opencode.managed.plist` in
`/Library/Managed Preferences` or any user's folder in it), which outranks Ori Kami's own.
Requests from opencode to write a file or run a terminal through Ori Kami are always refused.

**Held back** (shown on the Plugins page): workspace-write (opencode runs commands outside any
sandbox), `personal` instructions (they would need opencode's workspace config, which also runs the
workspace's plugins and MCP servers), background turns (a read outside the workspace needs a card),
other systems than macOS, and opencode outside `>=2.4.1 <2.5.0`.

**Usage.** None: quota is `unsupported`. Tokens per turn come from the `session/prompt` result.
The free models have a usage limit; once it is reached, opencode fails each prompt and the turn
fails as `rate-limited`. Near the limit a turn can also wait a long time with no output; Stop ends it.

Settings:

- **OpenCode CLI path**: `opencode` (found on `PATH`) or a full path.

**Fixtures.** `fixtures/2.4.1/` holds redacted real ACP traffic under Ori Kami's config:
`initialize`, a `session/new` reply with the free models, and four prompts (a reply, a read inside
the workspace, a denied read outside it, and a request to write and run a command that opencode,
offered neither tool, answers in text). `session-replay.test.ts` replays them. The host tests run
`apps/host/src/features/providers/fixtures/fake-opencode.ts`. With `ORIKAMI_LIVE_OPENCODE=1` (and
`ORIKAMI_OPENCODE_PATH`), `provider-opencode-live.test.ts` runs the checks on your real opencode.
