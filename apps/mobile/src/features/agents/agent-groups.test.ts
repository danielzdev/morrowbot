import type { Agent, LastMessage } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import { groupAgents, previewLine, sectionLabel, type AgentsDirectory, type ThreadActivityKind } from './agent-groups.ts';

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
  ],
};

function summary(query: string) {
  return groupAgents(directory, query).map(({ section, items }) => ({
    section: sectionLabel(section),
    agents: items.map(({ agent: { name }, status }) => `${name} (${status.kind})`),
  }));
}

describe('groupAgents', () => {
  it('pins agents that need you or are working, then lists the rest by folder', () => {
    expect(summary('')).toMatchInlineSnapshot(`
      [
        {
          "agents": [
            "Errand Bot (needs-approval)",
            "Garden Helper (needs-you)",
            "Zine Maker (needs-you)",
          ],
          "section": "Needs you",
        },
        {
          "agents": [
            "Trip Planner (queued)",
          ],
          "section": "Working",
        },
        {
          "agents": [
            "Lost Folder (idle)",
          ],
          "section": "Agents",
        },
        {
          "agents": [
            "Reading Buddy (unread)",
          ],
          "section": "Home",
        },
        {
          "agents": [],
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
              "Garden Helper (needs-you)",
              "Zine Maker (needs-you)",
            ],
            "section": "Needs you",
          },
          {
            "agents": [
              "Trip Planner (queued)",
            ],
            "section": "Working",
          },
          {
            "agents": [
              "Lost Folder (idle)",
            ],
            "section": "Agents",
          },
          {
            "agents": [
              "Reading Buddy (unread)",
            ],
            "section": "Home",
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
});

describe('previewLine', () => {
  it('shows a status that needs attention, else the newest message on one line', () => {
    const lines = Object.fromEntries(
      groupAgents(directory, '').flatMap(({ items }) => items.map((item) => [item.agent.name, previewLine(item)])),
    );
    expect(lines).toMatchInlineSnapshot(`
      {
        "Errand Bot": {
          "kind": "status",
          "text": "Needs approval",
          "tone": "warn",
        },
        "Garden Helper": {
          "kind": "status",
          "text": "Needs you: choose a provider",
          "tone": "warn",
        },
        "Lost Folder": {
          "kind": "empty",
        },
        "Reading Buddy": {
          "kind": "message",
          "text": "You: Three short novels",
        },
        "Trip Planner": {
          "kind": "status",
          "text": "Queued",
          "tone": "working",
        },
        "Zine Maker": {
          "kind": "status",
          "text": "Needs you",
          "tone": "warn",
        },
      }
    `);
  });
});
