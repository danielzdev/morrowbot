import type { Agent, LastMessage } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import {
  agentIndicator,
  groupAgents,
  previewText,
  sectionLabel,
  type AgentsDirectory,
  type ThreadActivityKind,
} from './agent-groups.ts';

const TIME = '2026-11-27T12:00:00.000Z';

function agent(id: string, name: string, folderId: string | null, bound = true): Agent {
  return {
    id,
    name,
    description: `${name} helps out`,
    workspace: { kind: 'dedicated', dir: `/agents/${id}` },
    avatar: { kind: 'bot', shape: 'chat', color: '#7c5cff', finish: 'flat' },
    provider: bound
      ? { kind: 'bound', pluginId: 'claude-code', selection: { kind: 'default' }, access: 'workspace-write', vendorSettings: 'isolated' }
      : { kind: 'unbound' },
    folderId,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function activity(agentId: string, kind: ThreadActivityKind) {
  return { hostId: 'studio-host', thread: { agentId }, activity: { kind } };
}

const messages: readonly LastMessage[] = [
  { agentId: 'reading-buddy', threadId: 'a', kind: 'assistant', preview: 'Older', at: '2026-11-27T10:00:00.000Z' },
  { agentId: 'reading-buddy', threadId: 'b', kind: 'user', preview: 'Three  short\nnovels', at: '2026-11-27T11:00:00.000Z' },
];

const directory: AgentsDirectory = {
  hosts: [{ id: 'studio-host', name: 'Studio Host' }],
  agents: [
    agent('errand-bot', 'Errand Bot', null),
    agent('zine-maker', 'Zine Maker', null),
    agent('reading-buddy', 'Reading Buddy', 'home'),
    agent('garden-helper', 'Garden Helper', 'home', false),
    agent('trip-planner', 'Trip Planner', 'travel'),
    agent('lost-folder', 'Lost Folder', 'deleted-folder'),
  ].map((entry) => ({ hostId: 'studio-host', agent: entry })),
  folders: [
    { id: 'home', name: 'Home', createdAt: TIME },
    { id: 'travel', name: 'Travel', createdAt: TIME },
    { id: 'empty', name: 'Empty', createdAt: TIME },
  ].map((folder) => ({ hostId: 'studio-host', folder })),
  lastMessages: messages.map((message) => ({ hostId: 'studio-host', message })),
  threads: [
    activity('errand-bot', 'working'),
    activity('errand-bot', 'needs-approval'),
    activity('trip-planner', 'queued'),
    activity('reading-buddy', 'unread'),
    activity('zine-maker', 'failed'),
    activity('lost-folder', 'working'),
  ],
};

function summary(query: string) {
  return groupAgents(directory, query).map(({ section, items }) => ({
    section: sectionLabel(section) ?? '(no header)',
    agents: items.map(({ agent: { name }, status }) => `${name} (${status.kind})`),
  }));
}

describe('groupAgents', () => {
  it('keeps every agent in its home whatever its status: unfiled first, then each folder', () => {
    expect(summary('')).toMatchInlineSnapshot(`
      [
        {
          "agents": [
            "Errand Bot (needs-approval)",
            "Lost Folder (working)",
            "Zine Maker (needs-you)",
          ],
          "section": "(no header)",
        },
        {
          "agents": [
            "Garden Helper (needs-you)",
            "Reading Buddy (unread)",
          ],
          "section": "Home",
        },
        {
          "agents": [
            "Trip Planner (queued)",
          ],
          "section": "Travel",
        },
        {
          "agents": [],
          "section": "Empty",
        },
      ]
    `);
  });

  it('searches names and descriptions, hiding sections left empty', () => {
    expect({ byName: summary('READING'), byDescription: summary('helps'), none: summary('zzz') }).toMatchInlineSnapshot(`
      {
        "byDescription": [
          {
            "agents": [
              "Errand Bot (needs-approval)",
              "Lost Folder (working)",
              "Zine Maker (needs-you)",
            ],
            "section": "(no header)",
          },
          {
            "agents": [
              "Garden Helper (needs-you)",
              "Reading Buddy (unread)",
            ],
            "section": "Home",
          },
          {
            "agents": [
              "Trip Planner (queued)",
            ],
            "section": "Travel",
          },
        ],
        "byName": [
          {
            "agents": [
              "Reading Buddy (unread)",
            ],
            "section": "Home",
          },
        ],
        "none": [],
      }
    `);
  });

  it('leaves out the unfiled section when every agent is in a folder', () => {
    const allFiled = { ...directory, agents: directory.agents.filter(({ agent }) => agent.folderId !== null && agent.folderId !== 'deleted-folder') };
    expect(groupAgents(allFiled, '').map(({ section }) => sectionLabel(section))).toMatchInlineSnapshot(`
      [
        "Home",
        "Travel",
        "Empty",
      ]
    `);
  });
});

describe('row text and indicator', () => {
  it('flags what needs you with a badge or dot, work with dots, and previews the newest message', () => {
    const rows = Object.fromEntries(
      groupAgents(directory, '').flatMap(({ items }) =>
        items.map((item) => [item.agent.name, { indicator: agentIndicator(item.status), preview: previewText(item.lastMessage) }]),
      ),
    );
    expect(rows).toMatchInlineSnapshot(`
      {
        "Errand Bot": {
          "indicator": {
            "kind": "badge",
            "label": "Needs approval",
            "tone": "warn",
          },
          "preview": null,
        },
        "Garden Helper": {
          "indicator": {
            "kind": "badge",
            "label": "No provider",
            "tone": "warn",
          },
          "preview": null,
        },
        "Lost Folder": {
          "indicator": {
            "animated": true,
            "kind": "working",
            "label": "Working",
          },
          "preview": null,
        },
        "Reading Buddy": {
          "indicator": {
            "kind": "unread",
          },
          "preview": "You: Three short novels",
        },
        "Trip Planner": {
          "indicator": {
            "animated": false,
            "kind": "working",
            "label": "Queued",
          },
          "preview": null,
        },
        "Zine Maker": {
          "indicator": {
            "kind": "badge",
            "label": "Error",
            "tone": "danger",
          },
          "preview": null,
        },
      }
    `);
  });
});
