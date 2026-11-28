import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { chatDisplay } from './display.ts';
import type { ToolStep, TurnStep } from './thread-model.ts';
import { ToolDetails, ToolGroup, ToolRow } from './ToolGroup.tsx';
import { commandDoing } from './command-kind.ts';
import { describeTool, groupSteps, groupSummary, turnSummary } from './tool-rows.ts';

const INFO = { appVersion: '1.0.0', homeDir: '/Users/sam', userName: 'sam', dataDir: '/Users/sam/.oribot' };
const WORKSPACE = '/Users/sam/.oribot/workspaces/agent-1';
const display = chatDisplay(INFO, WORKSPACE);

const tool = (toolUseId: string, name: string, input: unknown, outcome: ToolStep['outcome'] = 'ok'): ToolStep => ({
  kind: 'tool',
  toolUseId,
  name,
  input,
  outcome,
  startedAt: 1_000,
  endedAt: outcome === 'running' ? null : 3_500,
});

it('words each provider’s tool calls as one line, with paths shown privacy-safe', () => {
  const calls: [string, unknown][] = [
    ['Read', { file_path: '~/.oribot/workspaces/agent-1/SOUL.md' }],
    ['Edit', { file_path: '~/.oribot/workspaces/agent-1/notes/plan.md', old_string: '(12 characters)' }],
    ['Write', { file_path: '/Users/sam/Documents/taxes/2026/receipts.csv' }],
    ['Bash', { command: 'ls /Users/sam/Downloads && cat sam@example.com.txt\nrm -rf build', description: 'List files' }],
    ['Grep', { pattern: 'TODO', path: '~/code' }],
    ['Glob', { pattern: '**/*.md' }],
    ['WebFetch', { url: 'https://example.com/hours?id=1' }],
    ['TodoWrite', { todos: [] }],
    ['Shell', { command: 'npm test' }],
    ['Edit', { files: ['~/.oribot/workspaces/agent-1/a.md', '~/.oribot/workspaces/agent-1/b.md'] }],
    ['WebSearch', { query: 'opening hours' }],
    ['docs.search', {}],
    ['Read', { title: '~/projects/notes/today.md' }],
    ['Think', {}],
    ['Read', 'not an object'],
  ];
  expect(calls.map(([name, input]) => describeTool(name, input, display).text)).toMatchInlineSnapshot(`
    [
      "Read SOUL.md",
      "Edited notes/plan.md",
      "Wrote …/2026/receipts.csv",
      "Ran ls ~/Downloads && cat <email> …",
      "Searched for “TODO”",
      "Listed files matching **/*.md",
      "Fetched example.com",
      "Updated the to-do list",
      "Ran npm test",
      "Edited 2 files",
      "Searched the web for “opening hours”",
      "Used docs.search",
      "Read ~/projects/notes/today.md",
      "Thought it through",
      "Read a file",
    ]
  `);
});

it('words a running call short for the status beside the avatar: a file name, a host or a clipped query, never a command', () => {
  const calls: [string, unknown][] = [
    ['Read', { file_path: '~/.oribot/workspaces/agent-1/SOUL.md' }],
    ['Edit', { file_path: '~/.oribot/workspaces/agent-1/src/features/chat/Composer.tsx' }],
    ['Write', { file_path: '/Users/sam/Documents/taxes/2026/receipts.csv' }],
    ['Edit', { files: ['~/.oribot/workspaces/agent-1/a.md', '~/.oribot/workspaces/agent-1/b.md'] }],
    ['Bash', { command: 'cd app && npm test -- --run' }],
    ['Bash', { command: 'curl -H "Authorization: Bearer sk-secret" https://api.example.com' }],
    ['Grep', { pattern: 'mail sam@example.com about the very long pattern here' }],
    ['WebSearch', { query: 'opening hours' }],
    ['WebFetch', { url: 'https://github.com/org/repo/pull/1?token=abc' }],
    ['Glob', { pattern: '**/*.md' }],
    ['Read', {}],
    ['mcp__oribot__remember', { text: 'Sam likes tea' }],
  ];
  expect(calls.map(([name, input]) => describeTool(name, input, display).doing)).toMatchInlineSnapshot(`
    [
      "Reading SOUL.md",
      "Editing Composer.tsx",
      "Writing receipts.csv",
      "Editing 2 files",
      "Running tests",
      "Fetching from the web",
      "Searching for “mail <email> about the very lon…”",
      "Searching the web for “opening hours”",
      "Browsing github.com",
      "Finding files",
      "Reading a file",
      "Using a tool",
    ]
  `);
});

it('names the kind of work a shell command does, looking past setup steps, prefixes and shell wrappers', () => {
  const commands = [
    'npm test',
    'cd apps/desktop && npx vitest run',
    'CI=1 pnpm run test:unit',
    'cargo test --all',
    'git status --short',
    'git commit -m "wip"',
    'git push origin HEAD',
    'gh pr view 12',
    'npm install zod',
    'pip install -r requirements.txt',
    'npm run lint',
    'npx tsc -p .',
    'npm run build',
    'make',
    'ls -la ~/Downloads | head',
    'rm -rf build',
    "bash -lc 'npm ci'",
    'python3 scripts/report.py',
    'date',
    'cd somewhere',
  ];
  expect(Object.fromEntries(commands.map((command) => [command, commandDoing(command)]))).toMatchInlineSnapshot(`
    {
      "CI=1 pnpm run test:unit": "Running tests",
      "bash -lc 'npm ci'": "Installing packages",
      "cargo test --all": "Running tests",
      "cd apps/desktop && npx vitest run": "Running tests",
      "cd somewhere": "Running a command",
      "date": "Running a command",
      "gh pr view 12": "Checking GitHub",
      "git commit -m "wip"": "Committing changes",
      "git push origin HEAD": "Pushing changes",
      "git status --short": "Checking git",
      "ls -la ~/Downloads | head": "Looking through files",
      "make": "Building",
      "npm install zod": "Installing packages",
      "npm run build": "Building",
      "npm run lint": "Checking the code",
      "npm test": "Running tests",
      "npx tsc -p .": "Checking the code",
      "pip install -r requirements.txt": "Installing packages",
      "python3 scripts/report.py": "Running a script",
      "rm -rf build": "Changing files",
    }
  `);
});

it('sums a finished turn’s calls in one phrase, leaving out a noun the phrase before named; null with no calls', () => {
  const steps: TurnStep[] = [
    tool('1', 'Read', { file_path: 'a.md' }),
    tool('2', 'Read', { file_path: 'b.md' }),
    tool('3', 'Edit', { files: ['c.md', 'd.md'] }),
    tool('4', 'Bash', { command: 'make' }, 'error'),
    { kind: 'approval', approval: { approvalId: 'p', summary: 'Allow?', choices: [{ id: 'allow', label: 'Allow' }] }, ending: { kind: 'chosen', label: 'Allow' } },
    tool('5', 'Read', { file_path: 'e.md' }),
    tool('6', 'Bash', { command: 'npm test' }),
    tool('7', 'Write', { file_path: 'f.md' }),
  ];
  expect({ turn: turnSummary(steps, display), approvalsOnly: turnSummary(steps.filter(({ kind }) => kind === 'approval'), display) }).toMatchInlineSnapshot(`
    {
      "approvalsOnly": null,
      "turn": "read 3 files, edited 2, ran 2 commands, wrote 1 file",
    }
  `);
});

it('collapses consecutive successful calls into one summary row; failures, running calls and approvals stay apart', () => {
  const steps: TurnStep[] = [
    tool('1', 'Read', { file_path: 'a.md' }),
    tool('2', 'Read', { file_path: 'b.md' }),
    tool('3', 'Edit', { file_path: 'c.md' }),
    tool('4', 'Bash', { command: 'make' }, 'error'),
    tool('5', 'Read', { file_path: 'd.md' }),
    { kind: 'approval', approval: { approvalId: 'p', summary: 'Allow?', choices: [{ id: 'allow', label: 'Allow' }] }, ending: null },
    tool('6', 'Read', { file_path: 'e.md' }),
    tool('7', 'Glob', { pattern: '*' }),
    tool('8', 'Read', { file_path: 'f.md' }, 'running'),
  ];
  const items = groupSteps(steps).map((item) => {
    switch (item.kind) {
      case 'group':
        return `group: ${groupSummary(item.tools.map((each) => describeTool(each.name, each.input, display)))}`;
      case 'tool':
        return `${item.tool.outcome}: ${describeTool(item.tool.name, item.tool.input, display).text}`;
      case 'approval':
        return `approval: ${item.step.approval.summary}`;
    }
  });
  expect(items).toMatchInlineSnapshot(`
    [
      "group: Read 2 files · Edited 1 file",
      "error: Ran make",
      "ok: Read d.md",
      "approval: Allow?",
      "group: Read 1 file · Searched 1 time",
      "running: Read f.md",
    ]
  `);
});

it('applies the path rule inside Show details too, and redacts each value before it is serialized', () => {
  const read = tool('1', 'Read', { file_path: '/Users/sam/confidential/client/2026/file.txt', note: 'from sam@example.com in /Users/sam/x' });
  const shown = renderToString(h(ToolDetails, { tool: read, display, showInput: true, onToggleInput: () => undefined }));
  expect(/<pre[^>]*>([\s\S]*?)<\/pre>/.exec(shown)?.[1]).toMatchInlineSnapshot(`
    "{
      &quot;file_path&quot;: &quot;…/2026/file.txt&quot;,
      &quot;note&quot;: &quot;from &lt;email> in ~/x&quot;
    }"
  `);
});

it('renders a group collapsed and a row closed; details hold status, duration and redacted input only', () => {
  const shown = (html: string): string => html.replaceAll(/<svg.*?<\/svg>/g, '').replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ').trim();
  const row = tool('1', 'Bash', { command: 'cat /Users/sam/secrets.txt' });
  const group = renderToString(h(ToolGroup, { tools: [row, tool('2', 'Read', { file_path: 'a.md' })], display }));
  const closed = renderToString(h(ToolRow, { tool: row, display }));
  const details = (showInput: boolean): string => renderToString(h(ToolDetails, { tool: row, display, showInput, onToggleInput: () => undefined }));
  expect({
    group: shown(group),
    groupCollapsed: /aria-expanded="false"/.test(group) && !group.includes('tool-rows'),
    row: shown(closed),
    rowClosed: /aria-expanded="false"/.test(closed) && !closed.includes('tool-details'),
    details: shown(details(false)),
    detailsWithInput: shown(details(true)),
  }).toMatchInlineSnapshot(`
    {
      "details": "Done · 2s Show details",
      "detailsWithInput": "Done · 2s Hide details { &quot;command&quot;: &quot;cat ~/secrets.txt&quot; }",
      "group": "Ran 1 command · Read 1 file",
      "groupCollapsed": true,
      "row": "Ran cat ~/secrets.txt , Done",
      "rowClosed": true,
    }
  `);
});
