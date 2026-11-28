# OpenAI Codex (subscription)

A provider built into MorrowBot that answers with the Codex CLI you already have, signed in with
your own ChatGPT plan. It runs one shared daemon,

```
codex app-server -c thread_unload_delay_secs=0
```

through the SDK's `jsonRpcProcess`, started by provider-info and registered with the
host before any turn uses it. Each chat thread is a Codex thread, resumed by id, so
Codex keeps the conversation. Stop sends `turn/interrupt`; if Codex ignores it, the
host ends the daemon and the next turn gets a new one. A `turn/start` Codex never
answers also ends the daemon, unless a `turn/started` named the turn.

**Access.** Two profiles, both with your own Codex settings (`personal`) and reading outside the
workspace (`readsOutsideCwd`), in interactive or background mode:

- **read-only**: every thread starts or resumes with Codex's read-only sandbox, approvals `never`,
  the model provider the route check saw, and every 0.171 feature that runs code, writes files or
  acts on the desktop turned off (`TOOL_FEATURES` in `lockdown.ts`: the shell and its login-shell
  snapshot, unified exec, apps, plugins, hooks, sub-agents, browser and computer use, code mode,
  image generation) plus each configured MCP server. Web search stays as your Codex config sets it:
  it runs on OpenAI's side. Before the prompt goes out, the provider checks Codex's own report of
  the thread (sandbox and network, approval policy, permission profile, model provider,
  `mcpServerStatus/list`, `hooks/list`), then reads the account and route again, and refuses the
  turn if anything differs.
- **full**: starts or resumes with Codex's `danger-full-access` sandbox (`dangerFullAccess` on
  `turn/start`), approvals `never`, and the model provider the route check saw, keeping Codex's
  full shell and file access alongside MorrowBot's own MCP server. Stop cancels the active turn
  best-effort via `turn/interrupt`.

An unexpected approval request is declined without a card.

**Instructions.** Codex loads your `~/.codex/AGENTS.md` and the workspace's `AGENTS.md` by itself,
but not the agent's `SOUL.md`. MorrowBot sends `SOUL.md` as the thread's `developerInstructions`
on every `thread/start` and `thread/resume`; when it is not empty, it takes the place of a
`developer_instructions` from your Codex config for that thread.

**MorrowBot's tools.** The one MCP server a thread runs is the host's own for the turn
(`mcp_servers.morrowbot` in the thread's config overrides, replacing any server of yours by
that name, with `default_tools_approval_mode = "approve"`: approvals are `never`, so Codex
would block its calls otherwise). Codex takes MCP servers only when a thread opens, and each
turn's token ends with the turn, so a thread is let go after every turn and resumed cold for
the next one with that turn's token.

**Held back** (checked on Codex 0.171, shown on the Plugins page):

- everything, when an administrator manages Codex (`configRequirements/read` is not
  empty): managed rules apply after MorrowBot's and can turn tools back on;
- a model provider that gets its credentials by running a command (`auth.command`) or
  from AWS: the command would run outside the sandbox;
- workspace-write: a shell command that calls `setsid` keeps running after Stop;
- `isolated` instructions: Codex always loads your `~/.codex/AGENTS.md`;
- other systems than macOS, and Codex outside `>=0.171.0 <0.172.0`.

**Accounts and routes.** Before each turn the provider reads `account/read` and
`config/read {cwd}` once. Only the built-in `openai` provider with a ChatGPT login and
the default URLs is the plan route: its account key is the user and the ChatGPT
workspace, and its threads are saved. Any other route (an API key, another provider,
a custom `openai_base_url`, `chatgpt_base_url` or `model_providers.openai.base_url`,
a Codex `profile`, or an unknown workspace) runs each
turn on a new ephemeral thread with no plan usage. A changed account or route ends the
turn before the prompt, and again after the thread opens (`account-changed`, `route-changed`, `signed-out`).

**Sessions.** A thread already loaded in the daemon is reused only when it was loaded
with the same route and policy; otherwise it is unloaded (`thread/unsubscribe`, checked
with `thread/loaded/list`) and resumed with the policy again.

**Usage.** Plan windows from `account/rateLimits/read`, read between two account
checks and only on the plan route; a rate-limit notification during a turn triggers a
new read. Tokens per turn are the change in the thread's cumulative total.

Settings:

- **Codex CLI path**: `codex` (found on `PATH`) or a full path. The ChatGPT app ships
  one at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`.

**Fixtures.** `fixtures/0.171.0/` holds a redacted real session (a new thread's turn,
a second turn and a cold resume), replayed by `turn-stream.test.ts`, and a real
`account/rateLimits/read` answer. `schema/pinned.json` is the generated experimental
schema for every shape the provider reads or sends. With `MORROWBOT_LIVE_CODEX=1`,
`apps/host/src/features/providers/provider-openai-live*.test.ts` run the checks on your
real Codex and compare the schema (`MORROWBOT_PIN_CODEX_SCHEMA=1` rewrites it after a
version bump; read its diff). The turn checks spend a little of your plan.

**Credits.** The usage windows in `usage.ts` follow t3code's `codexUsageLimits.ts`
(MIT, `THIRD_PARTY_LICENSES/t3code-MIT.txt`).
