# Project & Architecture Decisions

Settled product, visual, security, and workflow decisions for MorrowBot so any contributor or agent can pick up work directly from this repository and its GitHub Issues.

## Visual Direction & UI
- **Palette ("Version B — Graphite"):** Neutral monochrome surfaces (`#0D0D0D` chrome, `#1A1A1A` canvas, `#212121`/`#242424` raised), white/black primary buttons, and signal blue (`#74B9FF` dark / `#0B5FC5` light) reserved for focus rings, active switches, links, unread dots, and steered-in labels.
- **No purple or violet anywhere in app chrome or default swatches.** Saved user avatars keep their stored hex values, while built-in default swatches exclude purple/violet.
- **Dark mode is the default on fresh installs** (`index.html` and `appearance.ts`), while Light and System options remain available and persisted preferences are respected.
- **Mobile parity:** `apps/mobile/src/lib/theme.ts` tracks desktop Graphite tokens (enforced by `theme.test.ts`).
- **User message bubble colors:** Outgoing user bubbles default to **Match bot** (automatically tinting to the active agent's avatar color with guaranteed WCAG AA `>= 4.5:1` contrast in light and dark mode). Users can switch globally in **Settings › Appearance** (`Match bot` / `Off` / `Custom`, defaulting custom to Sky `#0ea5e9`) or override per agent in **Agent Settings › General** (`Use global` / `Off` / `Custom`).
- **Chat avatars:** Live animated avatars appear in the active chat turn row (queued, thinking, tool run, writing, approval, brief done beat) and auto-hide when idle, while staying static on thread tabs and under Reduce Motion.

## First-Run Onboarding
- **One calm decision per screen:** Server choice (**Start my own server** vs **Join a server**) → Engine setup → First agent creation. Never auto-advance between steps.
- **Join a server:** Hidden behind a secondary button on screen 1; defaults to invite-link paste with a toggle to manual server address + code.
- **Built-in engine rows:** Show one calm indicator and at most one action (**Install** or **Sign in**). Do **not** show `How to install` links on built-in engines and do **not** show `Update` buttons during first-run onboarding (`Update` lives only in **Settings › Providers**).

## Agent Runtime, Security & Built-In Tools
- **Built-in providers (`packages/providers`):** Claude Code, OpenAI Codex, Google Antigravity, and OpenCode run in-host with per-turn process-group cleanup.
- **Built-in host MCP tools (`apps/host/src/features/agent-tools/`):**
  - Memories: `search_memories`, `remember`, `forget_memory`
  - Sub-agents (cross-model, inline chat cards): `spawn_subagent`, `wait_subagents`, `list_subagents`
  - Agent-to-agent messaging (quiet background turns by default): `list_agents`, `send_message`
  - Emoji reactions & silent replies: `react_to_message`, `stay_quiet`
  - Reply attachments (files from the agent's workspace shown under its reply): `attach_files`
  - Routines: `list_routines`, `create_routine`, `update_routine`, `delete_routine`, `routine_no_update`
  - Calm T3 Code watches: `list_t3_watches`, `watch_t3_thread`, `unwatch_t3_thread`, `ack_t3_batch`
  - Vault metadata lookup (values never exposed to agents): `list_vault_items`
- **Access profiles:** New owner agents default to `full` (shell/Bash) access when offered by the chosen provider (co-owners and providers without `full` fall back to the best non-full interactive profile). Switching an existing agent's provider preserves its current access level when offered and never silently escalates to `full`; the access picker lives concisely in **Agent Settings › Brain** and the composer popover (owner-only guard and confirmation warning when turning full access on).
- **Full-access Stop is best-effort:** Stop cancels the active turn (ending the provider's process or its `session/cancel`), and a provider is not held back from `full` because a command's detached or backgrounded child (`cmd &`, `setsid`) can outlive Stop.
- **Secrets Vault:** One AES-256-GCM encrypted file (`vault-secrets.json`) sealed under a single master key in the OS keystore (`com.legendarykoi.morrowbot.vault` on macOS Keychain; zero extra master-password prompts). Secrets are injected by `vaultId` inside MCP/Composio connector headers and browser `submit_secret` (password + TOTP with origin checks) and never returned to agents.
- **Fence (#146):** On macOS every program a built-in provider starts (turns, probes, daemons, and everything they start, such as a full-access agent's shell) runs under a Seatbelt profile (`packages/plugin-sdk/src/fence.ts`, set up in `apps/host/src/host-fence.ts`) that hides the data folder's `vault*` files, `morrowbot.sqlite*` and `server.json*`. It writes only in `workspaces/` and the built-in providers' own `plugin-data/` folders: never elsewhere in the data folder, the plugins folder or the app bundle. Those folders and their parents cannot be moved, and the data folder and its parents cannot be cloned (`clonefile(2)` would copy the hidden files out). Programs inside cannot ask macOS to start anything outside it (`open`, Apple Events, setuid tools; macOS already refuses `launchctl` jobs). The Keychain key stays readable through `/usr/bin/security`, because Claude Code reads its own login with that tool, but it opens nothing without `vault-secrets.json`. The host, its plugin workers and the command guards start Node with `--disable-sigusr1`, and packaged builds turn off Electron's inspector flags (`enableNodeCliInspectArguments` fuse), so a fenced program cannot open a debugger on an unfenced one. Plugin workers and stdio connectors are not fenced, and other programs you run that take commands (a tmux session, Docker, SSH into this Mac) are outside what the fence can see. An agent with full access can still leave a program behind that runs later outside MorrowBot, so full access stays for trusted agents only. A `vault.json` the host cannot read leaves the vault closed (no items, every change refused) instead of stopping the host, and a missing one erases no stored secret.
- **Extensions & built-in tool plugins:** Custom MCP servers (stdio + Streamable HTTP/SSE) and Composio connectors support per-agent enablement. Built-in tool plugins (`plugins/browser` + Chromium extension; `plugins/computer-use` native macOS helper) execute over the per-turn MCP tool bridge.

## Multi-Device & Remote Access
- **Primary path:** Tailscale + QR pairing (`MORROWBOT_HOST_BIND` bound to the Tailscale interface) and client-only **Join a server** desktop mode.
- **Deferred:** Zero-knowledge E2E cloud relay (`#58`) is deferred while Tailscale covers remote access.

## Storage & Migrations
- SQLite migrations live in `apps/host/src/features/storage/migration-<N>.ts` and are registered in `schema.ts`.
- Latest merged migration on `main`: **`migration-18.ts`** (`13` = Connectors, `14` = Sub-agents, `15` = Message reactions, `16` = Tool steps, `17` = Agent-message read outcomes & unread lookup index, `18` = Reply attachments). New schema changes start at `migration-19.ts` (always check `ls apps/host/src/features/storage/migration-*.ts` first).

## Engineering, CI & Review Workflow
- **CI (`.github/workflows/ci.yml`):** Uses affected-workspace detection (`.github/scripts/ci-changes.mjs`) to run `lint`, `typecheck-build`, and only affected workspace test jobs in parallel on PRs, failing open on root config changes and `push` to `main`, behind a single required `check` gate job. Local full verification stays `npm run check`.
- **PR reviews:** Routine code reviews alternate Claude and Gemini; multi-model PR council reviews run inside the PR's T3 Code thread using `.agents/skills/council/SKILL.md`.
- **Merging & releases:** Always merge via merge commit (`gh pr merge --merge --delete-branch`) to preserve AI contributor attribution. Signed macOS releases publish from `main` via `.github/workflows/private-release.yml` (see `apps/desktop/RELEASING.md`). Open work and follow-ups live in GitHub Issues.
