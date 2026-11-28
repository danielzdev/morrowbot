import type { Agent, EntityId, LastMessage, Thread } from '@morrowbot/contracts';
import { createStore } from '../../lib/store.ts';
import type { Directory, DirectorySource, ThreadActivity } from './directory.ts';

const MINUTE = 60_000;

function at(minutesAgo: number, now: number): string {
  return new Date(now - minutesAgo * MINUTE).toISOString();
}

function agent(id: string, name: string, description: string, color: string, folderId: string | null, now: number): Agent {
  return {
    id,
    name,
    description,
    workspace: { kind: 'dedicated', dir: `/agents/${id}` },
    avatar: { kind: 'bot', shape: 'chat', color, finish: 'flat' },
    provider:
      id === 'garden-helper'
        ? { kind: 'unbound' }
        : {
            kind: 'bound',
            pluginId: 'claude-code',
            selection: { kind: 'default' },
            access: 'workspace-write',
            vendorSettings: 'isolated',
          },
    folderId,
    emojiReplies: 'allowed',
    createdAt: at(60 * 24 * 30, now),
    updatedAt: at(60, now),
  };
}

function thread(agentId: string, id: string, title: string, minutesAgo: number, now: number): Thread {
  const createdDaysAgo = id.endsWith('-main') ? 30 : 7;
  return { id, agentId, title, createdAt: at(60 * 24 * createdDaysAgo, now), updatedAt: at(minutesAgo, now) };
}

function lastMessages(now: number): readonly LastMessage[] {
  return [
    { agentId: 'errand-bot', threadId: 'weekend-errands', kind: 'assistant', preview: 'Pharmacy first, then the hardware store before it closes at 6.', at: at(1, now) },
    { agentId: 'reading-buddy', threadId: 'reading-main', kind: 'assistant', preview: 'Here are three short novels you might like next.', at: at(33, now) },
    { agentId: 'recipe-coach', threadId: 'recipe-main', kind: 'user', preview: 'Something with lentils, please', at: at(60 * 3, now) },
    { agentId: 'trip-planner', threadId: 'trip-main', kind: 'user', preview: 'What about a train from Porto?', at: at(40, now) },
  ];
}

/** Made-up agents and threads on one host, shown while no host is paired. Ages are relative to `now` so the lists look current. */
export function sampleDirectory(now: number): Directory {
  const hostId = 'studio-host';
  const rows: readonly (readonly [Thread, ThreadActivity])[] = [
    [thread('errand-bot', 'errand-main', 'Errands', 2, now), { kind: 'needs-approval', summary: 'Book a pickup slot' }],
    [thread('errand-bot', 'weekend-errands', 'Plan the weekend errands', 1, now), { kind: 'working' }],
    [thread('reading-buddy', 'reading-main', 'Reading list', 33, now), { kind: 'unread' }],
    [thread('reading-buddy', 'book-club', 'Book club questions', 60 * 5, now), { kind: 'idle' }],
    [thread('trip-planner', 'trip-main', 'Trips', 40, now), { kind: 'queued' }],
    [thread('trip-planner', 'lisbon', 'Lisbon in spring', 60 * 26, now), { kind: 'idle' }],
    [thread('recipe-coach', 'recipe-main', 'Weeknight dinners', 60 * 3, now), { kind: 'idle' }],
    [thread('garden-helper', 'garden-main', 'Balcony garden', 60 * 24 * 3, now), { kind: 'failed' }],
  ];
  return {
    hosts: [{ id: hostId, name: 'Studio Host' }],
    agents: [
      agent('errand-bot', 'Errand Bot', 'Runs the household to-do list', '#7c5cff', null, now),
      agent('reading-buddy', 'Reading Buddy', 'Book notes and summaries', '#0ea5e9', 'home', now),
      agent('recipe-coach', 'Recipe Coach', 'Meal plans', '#f97316', 'home', now),
      agent('garden-helper', 'Garden Helper', 'Plants and watering', '#22c55e', 'home', now),
      agent('trip-planner', 'Trip Planner', 'Travel ideas', '#ec4899', 'travel', now),
    ].map((entry) => ({ hostId, agent: entry })),
    folders: [
      { id: 'home', name: 'Home', createdAt: at(60 * 24 * 60, now) },
      { id: 'travel', name: 'Travel', createdAt: at(60 * 24 * 60, now) },
    ].map((folder) => ({ hostId, folder })),
    lastMessages: lastMessages(now).map((message) => ({ hostId, message })),
    threads: rows.map(([entry, activity]) => ({ hostId, thread: entry, activity })),
  };
}

/** An in-memory directory over the sample data; new threads live only until the app closes. */
export function createSampleDirectory(clock: () => number = Date.now): DirectorySource {
  const store = createStore(sampleDirectory(clock()));
  let created = 0;
  return {
    store,
    createThread: (hostId: EntityId, agentId: EntityId) => {
      created += 1;
      const time = new Date(clock()).toISOString();
      const fresh: Thread = { id: `new-${String(created)}`, agentId, title: 'New chat', createdAt: time, updatedAt: time };
      store.update((directory) => ({
        ...directory,
        threads: [...directory.threads, { hostId, thread: fresh, activity: { kind: 'idle' } }],
      }));
      return Promise.resolve({ kind: 'created', thread: fresh });
    },
  };
}
