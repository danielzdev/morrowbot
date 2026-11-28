import { describe, expect, it } from 'vitest';
import { createSampleDirectory, sampleDirectory } from './sample-directory.ts';
import {
  agentChoices,
  filterLabel,
  folderChoices,
  groupThreads,
  NO_FILTER,
  type ThreadFilter,
  type ThreadGroup,
} from './thread-groups.ts';

const directory = sampleDirectory(Date.parse('2026-11-27T12:00:00.000Z'));

function titles(groups: readonly ThreadGroup[]) {
  return groups.map(({ kind, items }) => ({
    kind,
    threads: items.map(({ thread, agent, isMain }) => `${agent.name}: ${thread.title}${isMain ? ' (main)' : ''}`),
  }));
}

function only(filter: Partial<ThreadFilter>) {
  return titles(groupThreads(directory, { ...NO_FILTER, ...filter }));
}

describe('groupThreads', () => {
  it('sorts every thread into Needs you, Working and Recent, newest first', () => {
    expect(titles(groupThreads(directory, NO_FILTER))).toMatchInlineSnapshot(`
      [
        {
          "kind": "needs-you",
          "threads": [
            "Errand Bot: Errands (main)",
            "Garden Helper: Balcony garden (main)",
          ],
        },
        {
          "kind": "working",
          "threads": [
            "Errand Bot: Plan the weekend errands",
            "Trip Planner: Trips (main)",
          ],
        },
        {
          "kind": "recent",
          "threads": [
            "Reading Buddy: Reading list (main)",
            "Recipe Coach: Weeknight dinners (main)",
            "Reading Buddy: Book club questions",
            "Trip Planner: Lisbon in spring",
          ],
        },
      ]
    `);
  });

  it('narrows by folder, agent, Needs you and search', () => {
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
          {
            "kind": "needs-you",
            "threads": [
              "Errand Bot: Errands (main)",
              "Garden Helper: Balcony garden (main)",
            ],
          },
        ],
        "noMatch": [],
        "readingBuddy": [
          {
            "kind": "recent",
            "threads": [
              "Reading Buddy: Reading list (main)",
              "Reading Buddy: Book club questions",
            ],
          },
        ],
        "searchAgent": [
          {
            "kind": "recent",
            "threads": [
              "Recipe Coach: Weeknight dinners (main)",
            ],
          },
        ],
        "searchTitle": [
          {
            "kind": "recent",
            "threads": [
              "Trip Planner: Lisbon in spring",
            ],
          },
        ],
        "travelFolder": [
          {
            "kind": "working",
            "threads": [
              "Trip Planner: Trips (main)",
            ],
          },
          {
            "kind": "recent",
            "threads": [
              "Trip Planner: Lisbon in spring",
            ],
          },
        ],
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
  it('adds a new thread to Recent for the agent it was started in', () => {
    const source = createSampleDirectory(() => Date.parse('2026-11-27T12:00:00.000Z'));
    const thread = source.createThread('studio-host', 'recipe-coach');
    const groups = groupThreads(source.store.get(), {
      ...NO_FILTER,
      agent: { kind: 'agent', hostId: 'studio-host', agentId: 'recipe-coach' },
    });
    expect({ thread: { id: thread.id, title: thread.title }, groups: titles(groups) }).toMatchInlineSnapshot(`
      {
        "groups": [
          {
            "kind": "recent",
            "threads": [
              "Recipe Coach: New chat",
              "Recipe Coach: Weeknight dinners (main)",
            ],
          },
        ],
        "thread": {
          "id": "new-1",
          "title": "New chat",
        },
      }
    `);
  });
});
