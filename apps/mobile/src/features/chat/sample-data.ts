import type { Agent, Message, PluginEntry, ProviderInfo, Thread, ThreadState } from '@morrowbot/contracts';
import { sampleCatalog } from '../../lib/sample-catalog.ts';

/** Made-up records for `sampleChatHost`: generic names only, never a real person, device or path. */

const SAMPLE_NOW = Date.parse('2026-11-27T12:00:00.000Z');
const LATER = '2026-11-27T08:30:00.000Z';

const catalog = sampleCatalog(SAMPLE_NOW);

export const SAMPLE_AGENTS: readonly Agent[] = catalog.agents;
export const SAMPLE_THREADS: readonly Thread[] = catalog.threads.map(({ thread }) => thread);

const user = (id: string, threadId: string, text: string): Message => ({
  kind: 'user',
  id,
  threadId,
  text,
  createdAt: LATER,
  attachments: [],
});

const assistant = (id: string, threadId: string, text: string, outcome: Extract<Message, { kind: 'assistant' }>['outcome'] = { kind: 'completed', finishReason: 'stop' }): Message => ({
  kind: 'assistant',
  attachments: [],
  id,
  threadId,
  text,
  createdAt: LATER,
  outcome,
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

const LENTIL_DINNER = [
  'Here is a quick 30-minute **spiced red lentil soup** for a weeknight:',
  '',
  '- Sauté diced onion, carrot, garlic, and a spoonful of cumin in olive oil.',
  '- Stir in 1 cup rinsed red lentils, 4 cups broth, and a squeeze of lemon.',
  '- Simmer 20 minutes until tender, then finish with parsley and toasted bread.',
].join('\n');

export const SAMPLE_MESSAGES: Readonly<Record<string, readonly Message[]>> = {
  'errand-main': [
    user('m1', 'errand-main', 'Can you draft a 3-day plan for Lisbon?'),
    assistant('m2', 'errand-main', PLAN),
    user('m3', 'errand-main', 'Looks great. Save it to `notes/lisbon.md`.'),
  ],
  'weekend-errands': [
    user('m4', 'weekend-errands', 'What order should I run errands on Saturday?'),
    assistant('m4b', 'weekend-errands', 'Pharmacy first, then the hardware store before it closes at 6.'),
  ],
  'reading-main': [
    user('m5', 'reading-main', 'Any short novels to put on my list next?'),
    assistant('m6', 'reading-main', 'Here are three short novels you might like next.\n\n1. **Piranesi**\n2. **The Memory Police**\n3. **Small Things Like These**'),
  ],
  'book-club': [
    user('m7', 'book-club', 'Give me three discussion prompts for chapter 4.'),
    assistant('m8', 'book-club', '- What changes once the narrator leaves the island?\n- Which minor character notices the shift first?\n- Would the ending feel different from another viewpoint?'),
  ],
  'recipe-main': [
    user('m9', 'recipe-main', 'Something with lentils, please'),
    assistant('m10', 'recipe-main', LENTIL_DINNER),
  ],
  'garden-main': [
    user('m11', 'garden-main', 'When should I repot the basil on the balcony?'),
    assistant('m12', 'garden-main', 'Once roots peek through the drainage holes', { kind: 'interrupted' }),
  ],
  'trip-main': [
    user('m13', 'trip-main', 'What about a train from Porto?'),
    assistant('m14', 'trip-main', 'The Alfa Pendular from Porto-Campanhã to Lisbon Santa Apolónia takes about 2 hours 50 minutes and runs hourly.'),
  ],
  lisbon: [
    user('m15', 'lisbon', 'Draft a relaxed spring itinerary for Lisbon.'),
    assistant('m16', 'lisbon', PLAN),
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
