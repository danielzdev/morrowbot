# Google Antigravity (subscription)

A provider built into MorrowBot that answers with the Antigravity `agy` CLI you already have,
signed in with your own Google plan. It runs one shared daemon,

```
agy acp --gemini-dir <plugin data>/gemini
```

speaking the Agent Client Protocol (ACP v1) through the SDK's `jsonRpcProcess`. Provider-info
starts it and registers it with the host before any turn uses it. `--gemini-dir` gives MorrowBot its own
Antigravity settings, permission grants, hooks, plugins and MCP servers, apart from your
`~/.gemini`. The sign-in is still yours: agy keeps it in the system keychain.

**Turns.** Each turn opens a new ACP session (`session/new`) in the agent's workspace. It puts
the session in agy's Default mode, which asks before every edit and command, and sets the picked
model and thinking level (`session/set_config_option`). Then it sends `session/prompt`, and
closes the session at the end. Stop sends `session/cancel`. If agy ignores it, the host ends the
daemon and the next turn gets a new one.

agy reports a plan (`_meta.antigravity.tier`, shown as the account label) but no account, so the
account key is `''`. Every turn is therefore stateless: the host seeds it with the conversation, and
`capabilities.sessions` is false. `session/load` is still supported, with agy's replayed history
filtered out, for the day agy names an account.

**Access.** One profile: read-only, interactive, with your own skills (agy also reads
`~/.claude/skills`) and the workspace's instructions (`personal`):

- every write and every command agy asks permission for is denied without a card;
- a read, search or fetch it asks for (agy asks when one reaches outside the workspace) goes to an
  approval card, "Allow once" or "Deny". `allow_always` is never chosen;
- requests from agy to write a file or run a terminal through MorrowBot (`fs/write_text_file`,
  `terminal/*`) are refused, and the client offers neither;
- a turn is refused, before any session opens, in a workspace that has one of agy's own
  customization folders (`.agents`, `.agent`, `_agents`, `_agent`), there or in a folder above it up
  to its git root. agy runs the hooks, plugins and MCP servers in them without asking, even with its
  own `--gemini-dir` (checked on agy 1.5.18);
- if agy reports an edit or command that finished without asking, or leaves Default mode (during a
  turn, or while MorrowBot sets the session up), the turn fails (`access-not-supported`), the
  daemon ends at once with every turn on it, and the profile is withheld until the provider
  restarts. An open approval card is withdrawn and a late answer allows nothing.

**Held back** (checked on agy 1.5.18, shown on the Plugins page):

- workspace-write: MorrowBot cannot yet confine each write to the workspace, and agy runs commands
  outside any sandbox;
- `isolated` instructions: agy always loads the workspace's `AGENTS.md`;
- background turns: a read outside the workspace needs a card;
- other systems than macOS, and agy outside `>=1.5.18 <1.6.0`.

**Usage.** None. Plan quota is `unsupported`: the provider never calls Google's quota API
(`cloudcode-pa.googleapis.com`). Tokens per turn come from the `session/prompt` result.

Settings:

- **Antigravity CLI path**: `agy` (found on `PATH`) or a full path.

**Fixtures.** `fixtures/1.5.18/` holds redacted real ACP traffic: `initialize`, a `session/new`
reply with its models, and six prompts (a reply, a read inside the workspace, and denied writes,
commands and reads outside it). `session-replay.test.ts` and `models.test.ts` replay them. The host
tests run `apps/host/src/features/providers/fixtures/fake-agy.ts`. With `MORROWBOT_LIVE_AGY=1` (and
`MORROWBOT_AGY_PATH`), `provider-antigravity-live.test.ts` runs the checks on your real agy. The
live check spends a little of your plan.
