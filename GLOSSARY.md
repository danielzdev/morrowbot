# Glossary

Plain-English terms used across MorrowBot (used by the `wait-what` skill and contributors).

- **Host (Core Host):** The always-on background Node/TypeScript service that runs agents, routines, plugins, and SQLite storage even when the desktop window is closed.
- **Renderer (Window):** The Electron desktop UI that connects to the Host as a client. Never imports Host code directly.
- **Agent:** A persistent AI assistant with its own workspace folder, `AGENTS.md` instructions, skills, memories, and multi-chat tabs.
- **Background Turn:** A turn an agent runs, in the chat a message arrived in, to read a message from another agent. It adds no chat bubble and no unread badge: its answer goes back to the asking agent as a reply, and the chat shows it only inside the collapsible agent-message exchange. The agent tells the user something only by writing a line that says `[[notify-user]]`; what follows becomes a normal reply.
- **Plugin:** A free, open-source add-on that runs in its own isolated worker process and keeps all its settings on its own plugin page.
- **Built-in Provider:** A provider that ships inside MorrowBot (Claude, Codex, Antigravity and OpenCode, in `packages/providers`). It runs inside the host with no worker process and needs no plugins folder, but speaks the same protocol as a provider plugin, keeps its settings and on/off switch on its own page, and still starts each CLI in its own guarded process group.
- **Safe Mode:** Starting MorrowBot with all plugins and built-in providers temporarily turned off so a broken one can never stop the app from opening.
- **Notification Level:** Each agent's All, Quiet or Muted setting (right-click › Mute or Notifications…, or Agent Settings › Notifications), kept on this computer. All gives system notifications and the sidebar's unread dot; Quiet only the dot; Muted neither. Approval and problem badges always show.
- **Routine:** A scheduled or one-time background run for an agent, with a "stay quiet if nothing new" option.
- **Vault:** Encrypted storage for API keys, website logins, and secrets injected outside the agent so raw secrets never enter prompts.
- **Expect Test:** A test that records real output and compares future runs against it as a readable diff.
- **Feature Folder:** A directory under `features/<name>/` containing everything for one feature (UI, logic, types, tests) with lint blocking cross-feature imports.
- **Worktree:** A separate linked folder checked out on a feature branch so agents can work without changing `main`.
- **Shared Daemon:** One long-running provider process (such as Codex `app-server`) that a provider starts when the host first asks for its info, and that serves every turn of that provider until it is stopped or exits.
- **Recheck:** The Plugins page action that, with no turns running, stops a provider's daemon and starts a fresh one, so a sign-in, sign-out or account switch made in a terminal takes effect.
- **Paired Device:** A phone or other computer that claimed a one-time, 5-minute pairing code from the desktop and now holds its own long-lived token for the host. The host keeps only the token's hash; unpairing (revoking) the device stops the token and closes its connections at once.
- **Skill:** A folder with a `SKILL.md` whose frontmatter has a `name` and `description`. Global skills live in the data folder's `skills/`, an agent's own in its workspace's `.morrowbot/skills/` (these hide a global skill of the same name). Each turn gets the skills index; the agent reads a skill's file when it fits.
- **Memory:** A note one agent keeps across chats and restarts. `essential` memories go with every turn; `searchable` ones are found with keyword search and stay out of the prompt.
- **Attachment:** An image (PNG, JPEG, WebP) or text file uploaded to a chat and sent with a message. The host keeps its bytes in the data folder's `attachments/`; images go to the provider as images, text files inline in the prompt.
- **Queued Message:** A message sent while a reply runs. The host keeps it, marked as not seen by the agent, and sends it as the next turn once the reply completes. A Stop, failure or restart holds it instead, until the user sends, edits or cancels it.
- **Steer:** Sending a queued message into the running reply ("Steer now"). The reply so far is saved, the agent reads the message mid-turn (Claude's open stdin, Codex `turn/steer`) and answers it before carrying on; a provider that cannot take input mid-turn is stopped and resumed with the message instead.
- **T3 Watch:** The host's record of one T3 Code thread it follows for the orchestrator, registered through `/api/t3-watches` or the watch folder's `requests.jsonl`, or found by discovery. It reads the thread with `t3 thread show --json` and reports `needs_you`, `stalled`, `failed`, `finished`, `idle_unverified` or `watch_missing`, failing closed: it never says `finished` without two matching complete reads 20 s apart.
- **Browser Bridge:** The WebSocket on `127.0.0.1` between the Browser plugin and the MorrowBot browser extension. The extension proves it was paired with a token it generated, which the person pastes into the plugin's settings.
- **Takeover:** The agent handing a browser tab to the person for a step only they should do (a login, 2FA, payment or CAPTCHA). A banner on the page waits for **I'm done** or **Cancel**; agent commands on that tab are refused until then.
