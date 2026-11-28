import type { Agent, Folder, LastMessage, Thread } from '@morrowbot/contracts';

const MINUTE = 60_000;

function at(minutesAgo: number, now: number): string {
  return new Date(now - minutesAgo * MINUTE).toISOString();
}

function sampleAgent(
  id: string,
  name: string,
  description: string,
  shape: Agent['avatar']['shape'],
  color: string,
  finish: Agent['avatar']['finish'],
  folderId: string | null,
  provider: Agent['provider'],
  now: number,
): Agent {
  return {
    id,
    name,
    description,
    workspace: { kind: 'dedicated', dir: `/srv/orikami/agents/${id}` },
    avatar: { kind: 'bot', shape, color, finish },
    provider,
    folderId,
    emojiReplies: 'allowed',
    disabledExtensions: [],
    revision: 0,
    createdAt: at(60 * 24 * 30, now),
    updatedAt: at(60, now),
  };
}

function sampleThread(agentId: string, id: string, title: string, minutesAgo: number, now: number): Thread {
  const createdDaysAgo = id.endsWith('-main') ? 30 : 7;
  return { id, agentId, title, createdAt: at(60 * 24 * createdDaysAgo, now), updatedAt: at(minutesAgo, now), archivedAt: null };
}

export type SampleThreadActivity =
  | { readonly kind: 'idle' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'working' }
  | { readonly kind: 'needs-approval'; readonly summary: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'unread' };

export interface SampleCatalog {
  readonly hostId: string;
  readonly hostName: string;
  readonly agents: readonly Agent[];
  readonly folders: readonly Folder[];
  readonly threads: readonly { readonly thread: Thread; readonly activity: SampleThreadActivity }[];
  readonly lastMessages: readonly LastMessage[];
}

const CLAUDE_OPUS: Agent['provider'] = {
  kind: 'bound',
  pluginId: 'claude',
  selection: { kind: 'model', id: 'opus', choices: { effort: 'medium' } },
  access: 'workspace-write',
  vendorSettings: 'isolated',
};

const OPENAI_DEFAULT: Agent['provider'] = {
  kind: 'bound',
  pluginId: 'openai',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'isolated',
};

/**
 * Single source of truth for the offline sample workspace shared by the Agents/Threads lists
 * and the in-memory chat host. Generic names only: never a real person, device or path.
 */
export function sampleCatalog(now: number): SampleCatalog {
  const agents: readonly Agent[] = [
    sampleAgent('errand-bot', 'Errand Bot', 'Runs the household to-do list', 'lightbulb', '#3b82f6', 'matte', null, CLAUDE_OPUS, now),
    sampleAgent('reading-buddy', 'Reading Buddy', 'Book notes and summaries', 'sprout', '#0ea5e9', 'flat', 'home', OPENAI_DEFAULT, now),
    sampleAgent('recipe-coach', 'Recipe Coach', 'Meal plans', 'mug', '#f97316', 'flat', 'home', CLAUDE_OPUS, now),
    sampleAgent('garden-helper', 'Garden Helper', 'Plants and watering', 'watering-can', '#22c55e', 'flat', 'home', { kind: 'unbound' }, now),
    sampleAgent('trip-planner', 'Trip Planner', 'Travel ideas', 'star', '#ec4899', 'flat', 'travel', CLAUDE_OPUS, now),
  ];

  const folders: readonly Folder[] = [
    { id: 'home', name: 'Home', createdAt: at(60 * 24 * 60, now) },
    { id: 'travel', name: 'Travel', createdAt: at(60 * 24 * 60, now) },
  ];

  const threads: readonly { readonly thread: Thread; readonly activity: SampleThreadActivity }[] = [
    { thread: sampleThread('errand-bot', 'errand-main', 'Errands', 2, now), activity: { kind: 'needs-approval', summary: 'Book a pickup slot' } },
    { thread: sampleThread('errand-bot', 'weekend-errands', 'Plan the weekend errands', 1, now), activity: { kind: 'working' } },
    { thread: sampleThread('reading-buddy', 'reading-main', 'Reading list', 33, now), activity: { kind: 'unread' } },
    { thread: sampleThread('reading-buddy', 'book-club', 'Book club questions', 60 * 5, now), activity: { kind: 'idle' } },
    { thread: sampleThread('trip-planner', 'trip-main', 'Trips', 40, now), activity: { kind: 'queued' } },
    { thread: sampleThread('trip-planner', 'lisbon', 'Lisbon in spring', 60 * 26, now), activity: { kind: 'idle' } },
    { thread: sampleThread('recipe-coach', 'recipe-main', 'Weeknight dinners', 60 * 3, now), activity: { kind: 'idle' } },
    { thread: sampleThread('garden-helper', 'garden-main', 'Balcony garden', 60 * 24 * 3, now), activity: { kind: 'failed' } },
  ];

  const lastMessages: readonly LastMessage[] = [
    { agentId: 'errand-bot', threadId: 'weekend-errands', kind: 'assistant', preview: 'Pharmacy first, then the hardware store before it closes at 6.', at: at(1, now) },
    { agentId: 'reading-buddy', threadId: 'reading-main', kind: 'assistant', preview: 'Here are three short novels you might like next.', at: at(33, now) },
    { agentId: 'recipe-coach', threadId: 'recipe-main', kind: 'user', preview: 'Something with lentils, please', at: at(60 * 3, now) },
    { agentId: 'trip-planner', threadId: 'trip-main', kind: 'user', preview: 'What about a train from Porto?', at: at(40, now) },
  ];

  return { hostId: 'studio-host', hostName: 'Studio Host', agents, folders, threads, lastMessages };
}
