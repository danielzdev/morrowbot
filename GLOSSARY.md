# Glossary

Plain-English terms used across MorrowBot (used by the `wait-what` skill and contributors).

- **Host (Core Host):** The always-on background Node/TypeScript service that runs agents, routines, plugins, and SQLite storage even when the desktop window is closed.
- **Renderer (Window):** The Electron desktop UI that connects to the Host as a client. Never imports Host code directly.
- **Agent:** A persistent AI assistant with its own workspace folder, `AGENTS.md` instructions, skills, memories, and multi-chat tabs.
- **Plugin:** A free, open-source add-on that runs in its own isolated worker process and keeps all its settings on its own plugin page.
- **Safe Mode:** Starting MorrowBot with all plugins temporarily turned off so a broken plugin can never stop the app from opening.
- **Routine:** A scheduled or one-time background run for an agent, with a "stay quiet if nothing new" option.
- **Vault:** Encrypted storage for API keys, website logins, and secrets injected outside the agent so raw secrets never enter prompts.
- **Expect Test:** A test that records real output and compares future runs against it as a readable diff.
- **Feature Folder:** A directory under `features/<name>/` containing everything for one feature (UI, logic, types, tests) with lint blocking cross-feature imports.
- **Worktree:** A separate linked folder checked out on a feature branch so agents can work without changing `main`.
- **Shared Daemon:** One long-running provider process (such as Codex `app-server`) that a plugin starts when the host first asks for its info, and that serves every turn of that plugin until it is stopped or exits.
- **Recheck:** The Plugins page action that, with no turns running, stops a provider's daemon and starts a fresh one, so a sign-in, sign-out or account switch made in a terminal takes effect.
