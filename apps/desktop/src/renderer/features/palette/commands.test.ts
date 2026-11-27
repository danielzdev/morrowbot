import { expect, it } from 'vitest';
import { searchPalette, stepActive, type PaletteGroup, type PaletteItem } from './commands.ts';

const item = (group: PaletteGroup, label: string, detail = ''): PaletteItem => ({ id: `${group}:${label}`, group, label, detail, hint: '', leading: null, run: () => undefined });

const ITEMS: readonly PaletteItem[] = [
  item('actions', 'New chat with Errand Bot'),
  item('actions', 'New agent'),
  item('actions', 'Settings'),
  item('actions', 'Usage', 'Limits and tokens'),
  item('actions', 'Extensions'),
  item('actions', 'Toggle sidebar'),
  item('actions', 'Recheck Claude'),
  item('agents', 'Errand Bot'),
  item('agents', 'Reading Buddy'),
  item('agents', 'Inbox Helper'),
  ...Array.from({ length: 12 }, (_, index) => item('chats', `Chat ${String(index + 1)}`, 'Errand Bot')),
  item('chats', 'Grocery plan', 'Errand Bot'),
  item('chats', 'Novels to read', 'Reading Buddy'),
  item('settings', 'Theme', 'Appearance'),
  item('settings', 'Reduce motion', 'Appearance'),
  item('settings', 'Send with', 'Chat'),
  item('settings', 'Data folder', 'About'),
];

const shown = (query: string): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(searchPalette(ITEMS, query).map((section) => [section.group, section.items.map(({ label }) => label)]));

it('lists actions, agents and the 8 newest chats before a search, and no settings', () => {
  expect(shown('')).toMatchInlineSnapshot(`
    {
      "actions": [
        "New chat with Errand Bot",
        "New agent",
        "Settings",
        "Usage",
        "Extensions",
        "Toggle sidebar",
        "Recheck Claude",
      ],
      "agents": [
        "Errand Bot",
        "Reading Buddy",
        "Inbox Helper",
      ],
      "chats": [
        "Chat 1",
        "Chat 2",
        "Chat 3",
        "Chat 4",
        "Chat 5",
        "Chat 6",
        "Chat 7",
        "Chat 8",
      ],
    }
  `);
});

it('finds across every group by label first, then by detail, and fuzzily by word starts', () => {
  expect({ reading: shown('read'), theme: shown('theme'), fuzzy: shown('rb'), acronym: shown('nch'), twoWords: shown('errand groc'), none: shown('zzz') }).toMatchInlineSnapshot(`
    {
      "acronym": {
        "actions": [
          "New chat with Errand Bot",
        ],
      },
      "fuzzy": {
        "agents": [
          "Reading Buddy",
        ],
        "chats": [
          "Novels to read",
        ],
      },
      "none": {},
      "reading": {
        "agents": [
          "Reading Buddy",
        ],
        "chats": [
          "Novels to read",
        ],
      },
      "theme": {
        "settings": [
          "Theme",
        ],
      },
      "twoWords": {
        "chats": [
          "Grocery plan",
        ],
      },
    }
  `);
});

it('moves the highlight with wrap-around', () => {
  expect([stepActive(0, 1, 3), stepActive(2, 1, 3), stepActive(0, -1, 3), stepActive(0, 1, 0)]).toEqual([1, 0, 2, 0]);
});
