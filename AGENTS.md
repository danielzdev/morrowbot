# AGENTS.md

Hi! This is **MorrowBot** (working name): an open-source, VS-Code-style personal AI agent app built on a small TypeScript/Electron core and free, open-source plugins. What matters most: a tiny, rock-solid core; crash-isolated plugins; clean UI; and zero bloat.

Do not preserve complexity just because it already exists. YAGNI: do not build what we do not need yet. See `GLOSSARY.md` for project terms.

## Privacy & Branding
- Keep the owner's personal name out of all code, docs, app text, and IDs.
- Use `com.legendarykoi.morrowbot` for bundle and app IDs (publisher: Legendary Koi).

## Layout
- One feature, one folder (`features/<name>/`) holding its UI, logic, types, tests, and recorded outputs. Each plugin is one folder in `plugins/<name>/`.
- Separate the always-on host/main process from the Electron renderer window.
- A feature imports only from itself and shared contract packages—never from another feature. Renderer/window code never imports host/main code. Plugins import only `@morrowbot/plugin-sdk` and `@morrowbot/contracts`.
- No file over **400 lines**. Do not append to a large file; split into focused files inside the feature folder.
- Each piece of state has one owner; each task has one supported way. Delete the old way in the same change.

## TypeScript
- Parse outside data once at the boundary (IPC, plugin messages, SQLite rows, network) into a typed value (e.g. Zod). Code inside the boundary trusts the type.
- Model variants with a `kind` discriminated union so illegal states cannot be represented. No bags of optional fields.
- No `any`, no `as` casts, and exhaustive `switch` statements on `kind`.

## Tests
- Add a test only when it earns its place: it fails when behavior breaks and passes when only internals change. Prefer no new test over a bad/mock/slop test. No coverage target.
- First choice is an **expect test** (recorded output checked as a diff):
  - Verify the first recording against the spec or a worked example before committing.
  - Never accept an updated snapshot without reading its diff; never re-record just to turn a red test green; name every re-recorded test in the PR.
  - Keep each expect test small (one behavior) and record structured data unless formatting is the point.
- Use another test type only where expect tests fit poorly (property tests for invariants, or real app runs for multi-screen flows). Do not mock code that can run locally.
- When no cheap, clear test path exists, do not build throwaway scaffolding—run the closest real check and name it in the PR.

## Done Means Proven
- Run the real check and paste the command and its output in the PR. "It compiles" is not proof; unit tests alone are not proof for visible UI changes.
- State confidence clearly: `said so` / `pointed at the line` / `showed bad case cannot happen` / `ran it` / `reproduced in the running app`.
- For UI changes, run the app, inspect it visually, and include before/after screenshots.

## Bug Fixes & Refactors
- **Bug fixes:** Reproduce the bug first. When a cheap test path exists, commit the failing test before the fix. Every changed line must trace to runtime evidence.
- **Refactors:** Record current output first (expect test). Delete before adding; move every caller and remove old code in the same PR (no shims before 1.0). Revert if readability did not improve.

## Comments
- Keep only license headers, public API doc comments, links to upstream bugs/specs, and warnings that cannot be expressed in code.
- A comment explaining a workaround or saying "do not change" marks a missing check—add the type, lint rule, or test, and delete the comment.

## Git, PRs & Reviews
- Never push directly to `main`; always open a PR.
- Prefer merge commits or squash merging; do **not** rebase unless explicitly asked.
- PR titles use conventional commits: `type(scope): subject` (e.g. `feat(plugins): isolate worker crashes`).
- PR body under 40 lines using `.github/pull_request_template.md` (`## Why`, `## What changed`, `## Verification`, `## Risk`, `## AI`). Lead with the problem, not a file inventory.
- **AI attribution is allowed in this repository:** include model and harness in `## AI` and use `leaving-pr-comments` for agent-authored PR comments.
- **CodeRabbit** is our only automated GitHub review bot (no Greptile or Macroscope).
- **Council & cross-reviews:** Council models are Claude Opus, Gemini Neon, and GPT Sol (default 1–2 rounds unless asked for more). For routine cross-reviews, alternate Claude and Gemini; save GPT Sol for `council` or explicit `sol-loop`.

## When a Mistake Repeats
The second time the same kind of mistake happens, fix it at the highest level that works:
1. Structure (make the wrong thing impossible to write or import)
2. Types
3. A lint or CI check whose error message names the right replacement
4. A behavior test
5. A line in this file (last, only for judgment calls)

| Rule | Enforced by |
|---|---|
| Features do not import each other | `lint` (`morrowbot/import-boundaries`) |
| Renderer does not import host/main | `lint` (`morrowbot/import-boundaries`) |
| Plugins import only the plugin SDK and contracts | `lint` (`morrowbot/import-boundaries`) |
| No file over 400 lines | `lint` (`max-lines`) |
| No `any`, no `as`, exhaustive switches | `typescript-eslint` + `tsc` |
| PR size awareness (`size:XS`–`size:XL`) | `.github/workflows/size-label.yml` |
| No direct pushes or force pushes to `main` | GitHub `Protect Main` ruleset |
