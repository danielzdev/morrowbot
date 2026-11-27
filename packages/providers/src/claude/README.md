# Claude (subscription)

A provider built into MorrowBot that answers with the Claude Code CLI you already have, signed in
with your own Claude Pro or Max subscription. Each turn runs

```
claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --no-session-persistence --safe-mode --strict-mcp-config
  <access flags> [--model <id> [--effort <level>]] [--append-system-prompt-file <fd>]
```

in the agent's workspace folder, writes the conversation as one stream-json user frame
on stdin, and turns the JSON lines into turn chunks: text, status lines, tool calls
starting and ending, approval cards and plan usage. Stdin stays open for approval
answers and closes after the reply. Stopping a reply stops the CLI.

**Access.** Two profiles, both with MorrowBot's own instructions (the agent's
`AGENTS.md`, passed as the system prompt). Your own `CLAUDE.md`, skills, plugins,
hooks, MCP servers and settings files are not loaded, and there is no shell.

| Access | Flags |
|---|---|
| read-only | `--restricted --tools Read,Glob,Grep --permission-mode dontAsk --permission-prompts none` |
| workspace-write | `--restricted --tools Read,Glob,Grep,Edit,Write --permission-mode acceptEdits`, then `--permission-prompts host --permission-prompt-tool stdio` (interactive) or `--permission-prompts none` (background) |

`--restricted` keeps the file tools inside the workspace folder: a read or write
outside it is refused without asking. Workspace-write edits files in the folder
without asking, but a protected path such as `.git/` shows an approval card
(Allow or Deny). A background turn never asks and denies instead; an unanswered card
is denied after 30 minutes. `--permission-prompt-tool stdio` is not in `claude --help`,
but Claude Code 2.1.332 sends its `can_use_tool` requests on stdout only with it.

**Stateless.** Claude Code does not keep the conversation; every turn sends the
thread so far with the new message.

**Usage.** Each `rate_limit_event` becomes a live usage update for the session
(5-hour) and weekly windows. Until a turn has run, usage is "not yet observed".

**When it is held back.** The profile is withheld, with the reason shown, when:

- the CLI is outside the tested versions (`>=2.1.332 <2.2.0`; older is reported as outdated).
  CI fails when npm's latest Claude Code leaves this range (`packages/providers/scripts/check-latest-claude.ts`);
- an administrator manages Claude Code on this machine: anything in
  `/Library/Application Support/ClaudeCode` (macOS) or `/etc/claude-code` (Linux),
  a `com.anthropic.claudecode` profile in `/Library/Managed Preferences`, or cached
  server-managed settings (`remote-settings.json`, `state/hybrid-settings.json`) in
  the Claude config folder (`$CLAUDE_CONFIG_DIR`, or `~/.claude`). These are checked
  again before every turn;
- `claude auth status` does not show a personal Pro or Max login (Team, Enterprise,
  API keys and cloud providers are not supported yet).

Before every turn the provider also checks that the signed-in account is the one the
thread expects.

Settings:

- **Claude Code CLI path**: `claude` (found on `PATH`) or a full path.

**Fixtures.** `fixtures/2.1.332/` holds redacted transcripts of real 2.1.332 turns,
replayed by `wire.test.ts`. `apps/host/src/features/providers/provider-claude-live.test.ts`
runs the same checks on your real CLI with `MORROWBOT_LIVE_CLAUDE=1` (it spends a little
of your plan).

The model comes from the chat's model picker (`default`, `fable`, `opus`, `sonnet`,
`haiku`). Each alias offers an **Effort** option (low, medium, high, extra high, max;
high by default), the levels Claude Code 2.1.332 reports for it in its `initialize`
response (`fixtures/2.1.332/initialize-models.json`), and the turn passes
`--effort <level>`. A level the model does not offer refuses the turn before the CLI
starts. The CLI gets the host's `cli-runtime` environment (home, user, locale,
proxy and `CLAUDE_CONFIG_DIR`, see `manifest` in `index.ts`); macOS needs `USER` to read the
sign-in from the keychain. The prompt goes on stdin and the system prompt through a
file descriptor, so neither shows in the process list.
