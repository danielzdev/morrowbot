import type { Agent, Message, PluginEntry, ProviderInfo, Thread, ThreadState } from '@morrowbot/contracts';

/** Made-up records for `sampleChatHost`: generic names only, never a real person, device or path. */

const DAY = '2026-11-20T09:00:00.000Z';
const LATER = '2026-11-27T08:30:00.000Z';

export const SAMPLE_AGENTS: readonly Agent[] = [
  {
    id: 'errand-bot',
    name: 'Errand Bot',
    description: 'Plans trips and weekend errands.',
    workspace: { kind: 'dedicated', dir: '/srv/morrowbot/agents/errands' },
    avatar: { kind: 'bot', shape: 'lightbulb', color: '#7c5cff', finish: 'matte' },
    provider: {
      kind: 'bound',
      pluginId: 'claude',
      selection: { kind: 'model', id: 'opus', choices: { effort: 'medium' } },
      access: 'workspace-write',
      vendorSettings: 'isolated',
    },
    folderId: null,
    emojiReplies: 'allowed',
    createdAt: DAY,
    updatedAt: LATER,
  },
  {
    id: 'reading-buddy',
    name: 'Reading Buddy',
    description: 'Keeps book notes and summaries.',
    workspace: { kind: 'dedicated', dir: '/srv/morrowbot/agents/reading' },
    avatar: { kind: 'bot', shape: 'sprout', color: '#22a06b', finish: 'flat' },
    provider: { kind: 'bound', pluginId: 'openai', selection: { kind: 'default' }, access: 'read-only', vendorSettings: 'isolated' },
    folderId: null,
    emojiReplies: 'allowed',
    createdAt: DAY,
    updatedAt: LATER,
  },
];

const thread = (id: string, agentId: string, title: string, createdAt: string): Thread => ({
  id,
  agentId,
  title,
  createdAt,
  updatedAt: LATER,
  archivedAt: null,
});

export const SAMPLE_THREADS: readonly Thread[] = [
  thread('errand-main', 'errand-bot', 'Main', DAY),
  thread('weekend-errands', 'errand-bot', 'Plan the weekend errands', '2026-11-25T10:00:00.000Z'),
  thread('errand-budget', 'errand-bot', 'Budget', '2026-11-26T10:00:00.000Z'),
  thread('reading-main', 'reading-buddy', 'Main', DAY),
];

const user = (id: string, threadId: string, text: string): Message => ({
  kind: 'user',
  id,
  threadId,
  text,
  createdAt: LATER,
  attachments: [],
});

const PLAN = [
  'Here is a first pass for three relaxed days:',
  '',
  '## Day 1 · Alfama',
  '- Morning: **São Jorge Castle**, before the crowds',
  '- Afternoon: ride *tram 28* down to the river',
  '',
  '## Day 2 · Belém',
  '1. Jerónimos Monastery',
  '2. Pastries at the old bakery nearby',
  '',
  'I kept the plan as data too, so it is easy to edit:',
  '',
  '```json',
  '{ "days": 3, "pace": "relaxed", "budget": "mid" }',
  '```',
].join('\n');

export const SAMPLE_MESSAGES: Readonly<Record<string, readonly Message[]>> = {
  'errand-main': [
    user('m1', 'errand-main', 'Can you draft a 3-day plan for Lisbon?'),
    {
      kind: 'assistant',
      attachments: [],
      id: 'm2',
      threadId: 'errand-main',
      text: PLAN,
      createdAt: LATER,
      outcome: { kind: 'completed', finishReason: 'stop' },
    },
    user('m3', 'errand-main', 'Looks great. Save it to `notes/lisbon.md`.'),
  ],
  'weekend-errands': [user('m4', 'weekend-errands', 'What should I get done this weekend?')],
  'errand-budget': [],
  'reading-main': [
    user('m5', 'reading-main', 'Summarise chapter 3 of my book notes.'),
    {
      kind: 'assistant',
      attachments: [],
      id: 'm6',
      threadId: 'reading-main',
      text: 'Chapter 3 follows',
      createdAt: LATER,
      outcome: { kind: 'interrupted' },
    },
  ],
};

/** The turn that is waiting on the user when the sample opens, so an approval card shows at once. */
export const SAMPLE_ACTIVE: Readonly<Record<string, ThreadState['activeTurn']>> = {
  'errand-main': {
    generationId: 'gen-errand-1',
    trigger: { kind: 'chat' },
    state: 'running',
    queueNote: null,
    text: 'I will write the plan to `notes/lisbon.md`.',
    pendingApprovals: [
      {
        approvalId: 'approval-1',
        summary: 'Allow writing `notes/lisbon.md`?',
        choices: [
          { id: 'deny', label: 'Deny' },
          { id: 'allow', label: 'Allow' },
        ],
      },
    ],
    toolSteps: [],
  },
};

const EFFORT = {
  id: 'effort',
  label: 'Effort',
  defaultChoiceId: 'medium',
  choices: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ],
};

const ready = (models: Extract<ProviderInfo, { kind: 'ready' }>['models']): ProviderInfo => ({
  kind: 'ready',
  version: '1.0.0',
  accountKey: '',
  accountLabel: null,
  capabilities: {
    profiles: [{ access: 'workspace-write', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: false }],
    approvals: true,
    sessions: true,
    usage: 'none',
    withheld: [],
  },
  warning: null,
  models,
});

export const SAMPLE_PROVIDERS: Readonly<Record<string, ProviderInfo>> = {
  claude: ready([
    { id: 'opus', label: 'Opus', isDefault: true, options: [EFFORT] },
    { id: 'sonnet', label: 'Sonnet', isDefault: false, options: [EFFORT] },
  ]),
  openai: ready([{ id: 'gpt', label: 'GPT', isDefault: true, options: [{ ...EFFORT, id: 'reasoning', label: 'Reasoning' }] }]),
};

const plugin = (
  id: string,
  name: string,
  kind: 'provider' | 'tool',
  source: 'built-in' | 'user',
  status: PluginEntry['status'],
): PluginEntry => ({
  manifest: { protocolVersion: 1, id, name, version: '1.0.0', kind, main: 'index.js', permissions: [], envPreset: 'none', settingsSchema: {} },
  source,
  status,
  enabled: status.kind !== 'disabled',
  config: {},
  blockedGroups: [],
});

export const SAMPLE_PLUGINS: readonly PluginEntry[] = [
  plugin('claude', 'Claude', 'provider', 'built-in', { kind: 'running' }),
  plugin('openai', 'OpenAI', 'provider', 'built-in', { kind: 'running' }),
  plugin('web-search', 'Web Search', 'tool', 'user', { kind: 'running' }),
  plugin('notes-sync', 'Notes Sync', 'tool', 'user', { kind: 'unhealthy', detail: 'No reply for 30 seconds' }),
  plugin('weather', 'Weather', 'tool', 'user', { kind: 'disabled' }),
];
