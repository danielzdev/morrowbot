import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { chatDisplay } from './display.ts';
import type { ToolStep, TurnStep } from './thread-model.ts';
import { ToolDetails, ToolGroup, ToolRow } from './ToolGroup.tsx';
import { describeTool, groupSteps, groupSummary } from './tool-rows.ts';

const INFO = { appVersion: '1.0.0', homeDir: '/Users/sam', userName: 'sam', dataDir: '/Users/sam/.orikami' };
const WORKSPACE = '/Users/sam/.orikami/workspaces/agent-1';
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
    ['Read', { file_path: '~/.orikami/workspaces/agent-1/AGENTS.md' }],
    ['Edit', { file_path: '~/.orikami/workspaces/agent-1/notes/plan.md', old_string: '(12 characters)' }],
    ['Write', { file_path: '/Users/sam/Documents/taxes/2026/receipts.csv' }],
    ['Bash', { command: 'ls /Users/sam/Downloads && cat sam@example.com.txt\nrm -rf build', description: 'List files' }],
    ['Grep', { pattern: 'TODO', path: '~/code' }],
    ['Glob', { pattern: '**/*.md' }],
    ['WebFetch', { url: 'https://example.com/hours?id=1' }],
    ['TodoWrite', { todos: [] }],
    ['Shell', { command: 'npm test' }],
    ['Edit', { files: ['~/.orikami/workspaces/agent-1/a.md', '~/.orikami/workspaces/agent-1/b.md'] }],
    ['WebSearch', { query: 'opening hours' }],
    ['docs.search', {}],
    ['Read', { title: '~/projects/notes/today.md' }],
    ['Think', {}],
    ['Read', 'not an object'],
  ];
  expect(calls.map(([name, input]) => describeTool(name, input, display).text)).toMatchInlineSnapshot(`
    [
      "Read AGENTS.md",
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
