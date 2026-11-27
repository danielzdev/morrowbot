# Claude (subscription)

A provider plugin that answers with the Claude Code CLI you already have, signed in
with your own Claude subscription. It runs `claude --print --output-format stream-json
--verbose --include-partial-messages` and turns the JSON lines into stream chunks:
text deltas, status lines, tool calls starting and ending, and the final reply.
Stopping a reply stops the CLI.

Needs: Claude Code installed and signed in (`claude auth login`). The health check
says so when the CLI is missing or signed out.

Settings:

- **Model**: `default` keeps Claude Code's own choice; or `fable`, `opus`, `sonnet`, `haiku`.
- **Claude Code CLI path**: `claude` (found on `PATH`) or a full path.

The CLI runs in your home folder with your Claude Code settings and permissions, and
does not save its sessions. It receives only `PATH`, `HOME`, `USER`, and
`CLAUDE_CONFIG_DIR` from the host (see `manifest.json`); macOS needs `USER` to read
the sign-in from the keychain.
