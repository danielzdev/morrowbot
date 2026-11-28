import type { Agent, Folder } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { groupAgents, sectionKey, type AgentFacts } from './sidebar-groups.ts';

const BOUND: Agent['provider'] = { kind: 'bound', pluginId: 'provider-echo', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' };

const folder = (id: string, name: string): Folder => ({ id, name, createdAt: '2026-01-01T00:00:00.000Z' });
const FOLDERS = [folder('f-home', 'Home'), folder('f-work', 'Work'), folder('f-empty', 'Empty')];

function facts(name: string, change: Partial<AgentFacts> = {}, agentChange: Partial<Agent> = {}): AgentFacts {
  const agent: Agent = {
    id: `agent-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    description: '',
    workspace: { kind: 'dedicated', dir: '/data/workspaces/x' },
    avatar: { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat' },
    provider: BOUND,
    folderId: null,
    emojiReplies: 'allowed',
    disabledExtensions: [],
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...agentChange,
  };
  return { agent, providerReady: true, approvalChats: [], failed: false, working: null, unread: false, notify: 'all', lastMessage: null, ...change };
}

const shown = (groups: ReturnType<typeof groupAgents>) =>
  groups.flatMap((group) => [`# ${sectionKey(group.section)}`, ...group.entries.map(({ agent, status }) => `${agent.name}: ${JSON.stringify(status)}`)]);

it('keeps every agent in its own folder or Agents whatever its status; folders always show', () => {
  const all = [
    facts('Reading Buddy', { approvalChats: ['t1'], working: 'running' }, { folderId: 'f-home' }),
    facts('errand Bot', { working: 'running' }),
    facts('Zed Helper', {}, { provider: { kind: 'unbound' } }),
    facts('Inbox Helper', {}, { folderId: 'f-work' }),
    facts('Garden Pal', { providerReady: false, working: 'running' }),
    facts('Alarm Clock', { working: 'queued' }),
    facts('Notes', { failed: true }),
    facts('Mail Sorter', { unread: true }, { folderId: 'f-home' }),
    facts('Unopened', { providerReady: null }),
    facts('Lost Folder', {}, { folderId: 'f-gone' }),
  ];
  expect(shown(groupAgents(all, FOLDERS, ''))).toMatchInlineSnapshot(`
    [
      "# agents",
      "Alarm Clock: {"kind":"queued"}",
      "errand Bot: {"kind":"working"}",
      "Garden Pal: {"kind":"needs-you","reason":"provider"}",
      "Lost Folder: {"kind":"idle"}",
      "Notes: {"kind":"needs-you","reason":"failed"}",
      "Unopened: {"kind":"idle"}",
      "Zed Helper: {"kind":"needs-you","reason":"unbound"}",
      "# folder-f-home",
      "Mail Sorter: {"kind":"unread"}",
      "Reading Buddy: {"kind":"needs-approval","threadIds":["t1"]}",
      "# folder-f-work",
      "Inbox Helper: {"kind":"idle"}",
      "# folder-f-empty",
    ]
  `);
});

it('filters by name and description, ignoring case, and hides sections with no match', () => {
  const all = [facts('Errand Bot', {}, { description: 'Groceries and pharmacy runs', folderId: 'f-home' }), facts('Reading Buddy', {}, { description: 'Book notes' }), facts('Inbox Helper')];
  expect({
    byName: shown(groupAgents(all, FOLDERS, 'BUDDY')),
    byDescription: shown(groupAgents(all, FOLDERS, 'grocer')),
    none: groupAgents(all, FOLDERS, 'zzz'),
  }).toMatchInlineSnapshot(`
    {
      "byDescription": [
        "# folder-f-home",
        "Errand Bot: {"kind":"idle"}",
      ],
      "byName": [
        "# agents",
        "Reading Buddy: {"kind":"idle"}",
      ],
      "none": [],
    }
  `);
});

it('hides only the unread dot of a muted agent; a quiet agent keeps it, and approvals and problems always show', () => {
  const all = [
    facts('All New', { unread: true }),
    facts('Quiet New', { unread: true, notify: 'quiet' }),
    facts('Muted New', { unread: true, notify: 'muted' }),
    facts('Muted Asking', { unread: true, approvalChats: ['t1'], notify: 'muted' }),
    facts('Muted Failed', { unread: true, failed: true, notify: 'muted' }),
    facts('Muted Working', { working: 'running', notify: 'muted' }),
  ];
  expect(shown(groupAgents(all, [], ''))).toMatchInlineSnapshot(`
    [
      "# agents",
      "All New: {"kind":"unread"}",
      "Muted Asking: {"kind":"needs-approval","threadIds":["t1"]}",
      "Muted Failed: {"kind":"needs-you","reason":"failed"}",
      "Muted New: {"kind":"idle"}",
      "Muted Working: {"kind":"working"}",
      "Quiet New: {"kind":"unread"}",
    ]
  `);
});
