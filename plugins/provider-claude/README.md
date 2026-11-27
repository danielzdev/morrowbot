# Claude (subscription)

A provider plugin that answers with the Claude Code CLI you already have, signed in
with your own Claude Pro or Max subscription. Each turn runs

```
claude -p --output-format stream-json --verbose --include-partial-messages
  --no-session-persistence --safe-mode --strict-mcp-config --restricted
  --tools Read,Glob,Grep --permission-mode dontAsk --permission-prompts none
  [--model <id>] [--append-system-prompt-file <fd>]
```

in the agent's workspace folder and turns the JSON lines into turn chunks: text,
status lines, and tool calls starting and ending. Stopping a reply stops the CLI.

**Access.** One profile: read-only, with MorrowBot's own instructions (the agent's
`AGENTS.md`, passed as the system prompt). The CLI can only read, list and search
files; anything else is denied without asking. Your own `CLAUDE.md`, skills,
plugins, hooks, MCP servers and settings files are not loaded.

**Stateless.** Claude Code does not keep the conversation; every turn sends the
thread so far with the new message, on stdin.

**When it is held back.** The profile is withheld, with the reason shown, when:

- the CLI is outside the tested versions (`>=2.1.332 <2.2.0`; older is reported as outdated);
- an administrator manages Claude Code on this machine: anything in
  `/Library/Application Support/ClaudeCode` (macOS) or `/etc/claude-code` (Linux),
  a `com.anthropic.claudecode` profile in `/Library/Managed Preferences`, or cached
  server-managed settings (`remote-settings.json`, `state/hybrid-settings.json`) in
  the Claude config folder (`$CLAUDE_CONFIG_DIR`, or `~/.claude`). These are checked
  again before every turn;
- `claude auth status` does not show a personal Pro or Max login (Team, Enterprise,
  API keys and cloud providers are not supported yet).

Before every turn the plugin also checks that the signed-in account is the one the
thread expects.

Settings:

- **Claude Code CLI path**: `claude` (found on `PATH`) or a full path.

The model comes from the chat's model picker (`default`, `fable`, `opus`, `sonnet`,
`haiku`). The CLI gets the host's `cli-runtime` environment (home, user, locale,
proxy and `CLAUDE_CONFIG_DIR`, see `manifest.json`); macOS needs `USER` to read the
sign-in from the keychain. The prompt goes on stdin and the system prompt through a
file descriptor, so neither shows in the process list.
