# Google Antigravity (subscription)

A provider built into MorrowBot that answers with the Antigravity `agy` CLI you already have,
signed in with your own Google plan. It runs one shared daemon,

```
agy acp --gemini-dir <plugin data>/gemini
```

speaking the Agent Client Protocol (ACP v1) through the SDK's ACP client
(`acp.startAcpClient`, shared with OpenCode). Provider-info
starts it and registers it with the host before any turn uses it. `--gemini-dir` gives MorrowBot its own
Antigravity settings, permission grants, hooks, plugins and MCP servers, apart from your
`~/.gemini`. The sign-in is still yours: agy keeps it in the system keychain.

**No MorrowBot tools yet.** agy 1.5.18 reports no HTTP MCP support (`mcpCapabilities`), and a
stdio bridge would run a process agy starts outside MorrowBot's process guard, so its sessions
open with no MCP servers and its agents cannot message other agents or keep memories from a turn.

**Models.** agy lists its models, each model's thinking levels (they differ by model) and the plan
only inside a session. While none are known, or the user was signed out, provider-info opens a probe
session in the provider's data folder that never prompts: `session/new`, each model set in turn,
`session/close` (about 1 s on agy 1.5.18). A model agy will not switch to is skipped; the probe runs
again on the next provider-info until every model was tried. It uses what is left of a 27 s
budget that starts with provider-info, under the host's 30 s deadline. A `session/new`
refused for sign-in (`-32000`) answers `signed-out` at once. If the probe cannot run in time,
provider-info answers `ready-models-later`.

**Turns.** Each turn opens a new ACP session (`session/new`) in the agent's workspace. It puts
the session in agy's Default mode, which asks before every edit and command, and sets the picked
model and thinking level (`session/set_config_option`). Then it sends `session/prompt`, and
closes the session at the end. agy loads the workspace's `AGENTS.md` by itself but not the agent's
`SOUL.md`, so MorrowBot sends `SOUL.md` ahead of every prompt in an `<instructions>` block. Stop sends `session/cancel`. If agy ignores it, the host ends the
daemon and the next turn gets a new one.

agy reports a plan (`_meta.antigravity.tier`, shown as the account label) but no account, so the
account key is `''`. Every turn is therefore stateless: the host seeds it with the conversation, and
`capabilities.sessions` is false. `session/load` is still supported, with agy's replayed history
filtered out, for the day agy names an account.

**Access.** Two profiles, both with your own skills (agy also reads `~/.claude/skills`) and the
workspace's instructions (`personal`).

**Full** (interactive and background; only the owner may choose it): the session stays in Default
mode and MorrowBot allows everything agy asks for once, without a card (never `allow_always`, so no
grant is saved for read-only sessions). The client stops fencing that session (`allowChanges`,
remembered after it ends so a late update cannot trip the fence), and the workspace's
customization folders are not checked. Stop sends `session/cancel`, which ends the command agy is
running (checked on real agy 1.5.18 by
`provider-antigravity-live.test.ts`; the fixture test checks that Stop sends it). agy runs each
command in its own process group, so something a command leaves running in the background (`cmd &`)
outlives Stop and the daemon; MorrowBot does not chase it (see `docs/decisions.md`). A full-access
turn can also change MorrowBot's own Antigravity folder (`--gemini-dir`), and read-only turns then
run with what it set, such as a hook or an MCP server.

**Read-only** (interactive):

- every write and every command agy asks permission for is denied without a card;
- a read, search or fetch it asks for (agy asks when one reaches outside the workspace) goes to an
  approval card, "Allow once" or "Deny". `allow_always` is never chosen;
- requests from agy to write a file or run a terminal through MorrowBot (`fs/write_text_file`,
  `terminal/*`) are refused, and the client offers neither;
- a turn is refused in a workspace that has one of agy's own customization folders (`.agents`,
  `.agent`, `_agents`, `_agent`), there or in a folder above it up to its git root, on its path as
  given or its real path. agy runs the hooks, plugins and MCP servers in them without asking, even
  with its own `--gemini-dir` (checked on agy 1.5.18). The check runs before the session opens and
  again just before the prompt; a folder another program adds during the turn is not seen;
- if agy reports an edit or command that finished without asking, in any session on the daemon
  but a full one (even one MorrowBot has not finished setting up, and the provider-info probe), or
  a read-only session leaves Default mode, every turn on the daemon fails at once
  (`access-not-supported`), the daemon ends, and both profiles are withheld
  until the provider restarts, with no new daemon started. Open approval cards are withdrawn and a
  late answer allows nothing. A change agy reports only as `failed`, or not at all, is not seen.

**Held back** (checked on agy 1.5.18, shown on the Plugins page):

- workspace-write: MorrowBot cannot yet confine each write to the workspace, and agy runs commands
  outside any sandbox;
- `isolated` instructions: agy always loads the workspace's `AGENTS.md`;
- background read-only turns: a read outside the workspace needs a card;
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
