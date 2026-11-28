# Set up your AI engines

MorrowBot doesn't ship its own AI. It drives the AI tools already on your computer, each in its own process. One ready engine is enough to start chatting.

Open **Settings › Providers** (or the first-run checklist) to see each engine's status. Built-in engines offer 1-click **Install** during first-run setup and in **Settings › Providers** (1-click **Update** lives only in **Settings › Providers** so first-run setup stays focused). After you install, update or sign in to one, switch back to MorrowBot: it checks again by itself. You can also press **Recheck**.

On macOS, when an engine needs a sign-in, **Sign in** opens Terminal with that engine's own sign-in command. MorrowBot never sees your password.

## Claude

Uses your Claude subscription through Claude Code.

1. Install Claude Code: <https://docs.claude.com/claude-code>.
2. In a terminal, run `claude` once and sign in with your Claude account. Or press **Sign in** in MorrowBot.
3. MorrowBot supports Claude Code 2.1.332 up to (not including) 2.2.0. If it says **Needs update**, update Claude Code.

If Claude Code is installed somewhere MorrowBot can't find, set **Claude Code CLI path** in Settings › Providers › Claude.

## OpenAI Codex

Uses your ChatGPT plan through the Codex CLI.

1. Install the Codex CLI: <https://developers.openai.com/codex/cli>. The ChatGPT desktop app also ships one inside the app.
2. In a terminal, run `codex login` and sign in with your ChatGPT account. Or press **Sign in** in MorrowBot.
3. MorrowBot supports Codex 0.171.x.

If Codex is installed somewhere MorrowBot can't find, set **Codex CLI path** in Settings › Providers › Codex.

## Google Antigravity

Uses your Google account through Antigravity's `agy` command-line tool.

1. Install Google Antigravity: <https://antigravity.google>.
2. Open Antigravity once and sign in with your Google account. Or press **Sign in** in MorrowBot.
3. MorrowBot supports `agy` 1.5.18 up to (not including) 1.6.0.

Antigravity doesn't report plan limits, so Usage shows no bar for it.

## OpenCode

Uses OpenCode's free models. No account or sign-in is needed.

1. Install the opencode CLI, version 2.4.1 or a later 2.4 release: <https://opencode.ai>.
2. Switch back to MorrowBot; it checks again by itself.

## Community providers

A plugin can add another engine. Follow that plugin's own setup steps, then press **Recheck** in Settings › Providers. MorrowBot never runs a community provider's sign-in command for you.

## Still stuck?

- **Not installed:** MorrowBot couldn't find the command. Install it, or set its CLI path in Settings › Providers.
- **Sign-in needed:** sign in with the engine's own command, then switch back.
- **Turned off:** turn it on in Settings › Providers.
- **Couldn't check provider:** press Recheck. If it keeps failing, restart MorrowBot.
