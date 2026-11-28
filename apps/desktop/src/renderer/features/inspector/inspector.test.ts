import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { previewOf, type InspectorFacts } from './inspector-facts.ts';
import { InspectorCards } from './InspectorCards.tsx';

const ignore = (): void => undefined;
const ACTIONS = { onEditAgent: ignore, onCopyPath: ignore, onReveal: ignore, onEditBrain: ignore, onEditInstructions: ignore };

/** Each card as "Title: fact=value; text", so the test reads what the drawer says. */
function cards(facts: InspectorFacts): string[] {
  const html = renderToString(h(InspectorCards, { facts, actions: ACTIONS }));
  const sections = html.split('<section').slice(1);
  return sections.map((section) => {
    const title = /<h3[^>]*>([^<]*)<\/h3>/.exec(section)?.[1] ?? '?';
    const facts = [...section.matchAll(/<dt>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map(([, label, value]) => `${label ?? ''}=${value ?? ''}`);
    const text = [...section.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map(([, each]) => each ?? '');
    return `${title}: ${[...facts, ...text].join('; ')}`;
  });
}

it('shows "Not reported" for every field the renderer does not receive (spec §3.4)', () => {
  const checking: InspectorFacts = {
    description: '',
    workspace: { path: '~/.morrowbot/workspaces/a1', kind: 'dedicated' },
    brain: { kind: 'bound', provider: 'Codex', status: 'Checking…', ready: false, model: null, access: 'Read only', warnings: [], stateless: false },
    instructions: { kind: 'failed' },
  };
  const stateless: InspectorFacts = {
    description: 'Keeps the grocery list.',
    workspace: { path: '…/shared/notes', kind: 'shared' },
    brain: { kind: 'bound', provider: 'Antigravity', status: 'Ready', ready: true, model: 'Gemini 3 Pro', access: 'Read only', warnings: ['Reads files outside its workspace.'], stateless: true },
    instructions: { kind: 'missing' },
  };
  expect({ checking: cards(checking), stateless: cards(stateless), unbound: cards({ ...checking, brain: { kind: 'unbound' } }).filter((line) => line.startsWith('Brain')) }).toMatchInlineSnapshot(`
    {
      "checking": [
        "Agent: No description.",
        "Workspace: ~/.morrowbot/workspaces/a1; Dedicated: only this agent uses it.",
        "Brain: Provider=Codex; Status=Checking…; Model=Not reported; Access=Read only",
        "Instructions: Not reported",
        "This chat: Last turn tokens=Not reported; Model that replied=Not reported",
      ],
      "stateless": [
        "Agent: Keeps the grocery list.",
        "Workspace: …/shared/notes; Shared: other agents may use it too.",
        "Brain: Provider=Antigravity; Status=Ready; Model=Gemini 3 Pro; Access=Read only",
        "Session: This provider gets recent chat history each turn, within its limits.",
        "Instructions: No AGENTS.md yet.",
        "This chat: Last turn tokens=Not reported; Model that replied=Not reported",
      ],
      "unbound": [
        "Brain: This agent has no provider yet, so it can't reply.",
      ],
    }
  `);
});

it('previews the first six lines of AGENTS.md and tells missing, empty and unreadable apart', () => {
  const safe = (text: string): string => text.replaceAll('/Users/sam', '~');
  expect({
    missing: previewOf({ content: null, revision: null }, safe),
    unreadable: previewOf({ content: null, revision: 'r1' }, safe),
    empty: previewOf({ content: ' \n\n', revision: 'r1' }, safe),
    long: previewOf({ content: ['# Errand Bot', 'Notes live in /Users/sam/notes', '3', '4', '5', '6', '7'].join('\n'), revision: 'r1' }, safe),
  }).toMatchInlineSnapshot(`
    {
      "empty": {
        "kind": "empty",
      },
      "long": {
        "kind": "text",
        "lines": [
          "# Errand Bot",
          "Notes live in ~/notes",
          "3",
          "4",
          "5",
          "6",
        ],
        "more": true,
      },
      "missing": {
        "kind": "missing",
      },
      "unreadable": {
        "kind": "unreadable",
      },
    }
  `);
});
