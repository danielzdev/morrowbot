import { describe, expect, it } from 'vitest';
import { createSampleDirectory, sampleDirectory } from './sample-directory.ts';
import {
  agentChoices,
  filterLabel,
  folderChoices,
  listThreads,
  NO_FILTER,
  threadIndicator,
  type ThreadFilter,
  type ThreadItem,
} from './thread-groups.ts';

const directory = sampleDirectory(Date.parse('2026-11-27T12:00:00.000Z'));

function titles(items: readonly ThreadItem[]) {
  return items.map(({ thread, agent, activity, isMain }) => `${agent.name}: ${thread.title} [${activity.kind}]${isMain ? ' (main)' : ''}`);
}

function only(filter: Partial<ThreadFilter>) {
  return titles(listThreads(directory, { ...NO_FILTER, ...filter }));
}

describe('listThreads', () => {
  it('lists every thread in one list, newest first, whatever its status', () => {
    expect(titles(listThreads(directory, NO_FILTER))).toMatchInlineSnapshot(`
      [
        "Errand Bot: Plan the weekend errands [working]",
        "Errand Bot: Errands [needs-approval] (main)",
        "Reading Buddy: Reading list [unread] (main)",
        "Trip Planner: Trips [queued] (main)",
        "Recipe Coach: Weeknight dinners [idle] (main)",
        "Reading Buddy: Book club questions [idle]",
        "Trip Planner: Lisbon in spring [idle]",
        "Garden Helper: Balcony garden [failed] (main)",
      ]
    `);
  });

  it('narrows by folder, agent, Needs you (approval, error or unread) and search', () => {
    expect({
      travelFolder: only({ folder: { kind: 'folder', hostId: 'studio-host', folderId: 'travel' } }),
      readingBuddy: only({ agent: { kind: 'agent', hostId: 'studio-host', agentId: 'reading-buddy' } }),
      needsYou: only({ needsYouOnly: true }),
      searchTitle: only({ query: '  LISBON ' }),
      searchAgent: only({ query: 'recipe' }),
      noMatch: only({ query: 'zzz' }),
    }).toMatchInlineSnapshot(`
      {
        "needsYou": [
          "Errand Bot: Errands [needs-approval] (main)",
          "Reading Buddy: Reading list [unread] (main)",
          "Garden Helper: Balcony garden [failed] (main)",
        ],
        "noMatch": [],
        "readingBuddy": [
          "Reading Buddy: Reading list [unread] (main)",
          "Reading Buddy: Book club questions [idle]",
        ],
        "searchAgent": [
          "Recipe Coach: Weeknight dinners [idle] (main)",
        ],
        "searchTitle": [
          "Trip Planner: Lisbon in spring [idle]",
        ],
        "travelFolder": [
          "Trip Planner: Trips [queued] (main)",
          "Trip Planner: Lisbon in spring [idle]",
        ],
      }
    `);
  });
});

describe('threadIndicator', () => {
  it('badges approvals and errors, dots unread, and shows dots that move only while running', () => {
    const byKind = Object.fromEntries(
      listThreads(directory, NO_FILTER).map(({ activity }) => [activity.kind, threadIndicator(activity)]),
    );
    expect(byKind).toMatchInlineSnapshot(`
      {
        "failed": {
          "kind": "badge",
          "label": "Error",
          "tone": "danger",
        },
        "idle": {
          "kind": "none",
        },
        "needs-approval": {
          "kind": "badge",
          "label": "Needs approval",
          "tone": "warn",
        },
        "queued": {
          "animated": false,
          "kind": "working",
          "label": "Queued",
        },
        "unread": {
          "kind": "unread",
        },
        "working": {
          "animated": true,
          "kind": "working",
          "label": "Working",
        },
      }
    `);
  });
});

describe('filter choices', () => {
  it('offers all folders, then agents narrowed to the chosen folder', () => {
    const home: ThreadFilter['folder'] = { kind: 'folder', hostId: 'studio-host', folderId: 'home' };
    expect({
      folders: folderChoices(directory).map(({ label }) => label),
      agentsInHome: agentChoices(directory, home).map(({ label }) => label),
      chosenLabel: filterLabel(folderChoices(directory), home),
      goneFallsBack: filterLabel(agentChoices(directory, home), { kind: 'agent', hostId: 'studio-host', agentId: 'trip-planner' }),
    }).toMatchInlineSnapshot(`
      {
        "agentsInHome": [
          "All agents",
          "Garden Helper",
          "Reading Buddy",
          "Recipe Coach",
        ],
        "chosenLabel": "Home",
        "folders": [
          "All folders",
          "Home",
          "Travel",
        ],
        "goneFallsBack": "All agents",
      }
    `);
  });
});

describe('createSampleDirectory', () => {
  it('adds a new thread to the top of the list for the agent it was started in', () => {
    const source = createSampleDirectory(() => Date.parse('2026-11-27T12:00:00.000Z'));
    const thread = source.createThread('studio-host', 'recipe-coach');
    const items = listThreads(source.store.get(), {
      ...NO_FILTER,
      agent: { kind: 'agent', hostId: 'studio-host', agentId: 'recipe-coach' },
    });
    expect({ thread: { id: thread.id, title: thread.title }, list: titles(items) }).toMatchInlineSnapshot(`
      {
        "list": [
          "Recipe Coach: New chat [idle]",
          "Recipe Coach: Weeknight dinners [idle] (main)",
        ],
        "thread": {
          "id": "new-1",
          "title": "New chat",
        },
      }
    `);
  });
});
