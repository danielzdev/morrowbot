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

The CLI runs in the plugin's own empty data folder, so its file tools see none of
your files, and it does not save its sessions. The prompt goes on stdin and the
system prompt through a pipe, so neither shows in the process list. The CLI
receives only `PATH`, `HOME`, `USER`, and `CLAUDE_CONFIG_DIR` from the host (see
`manifest.json`); macOS needs `USER` to read the sign-in from the keychain.
