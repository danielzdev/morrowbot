import { expect, it } from 'vitest';
import { INDEX, KEY_ROWS, keysOf, searchSettings, targetOf, type SettingEntry } from './settings-index.ts';

const ids = (query: string): readonly string[] => searchSettings(query).flatMap(({ entries }) => entries.map(({ id }) => id));
const found = (query: string, entry: SettingEntry): boolean => searchSettings(query).some(({ section, entries }) => section === entry.section && entries.includes(entry));

it('finds every row by its label and by its description, in any case', () => {
  const missed = INDEX.flatMap((entry) =>
    [entry.label, entry.description, entry.label.toUpperCase(), entry.description.toLowerCase()].filter((query) => !found(query, entry)).map((query) => `${entry.id}: ${query}`),
  );
  expect(missed).toEqual([]);
  expect(new Set(INDEX.map(({ id }) => id)).size).toBe(INDEX.length);
});

it('matches every word anywhere in a row, groups matches by section in nav order, and finds nothing for blank text', () => {
  expect({
    motion: searchSettings('motion').map(({ section, entries }) => ({ section, rows: entries.map(({ id }) => id) })),
    words: ids('dark light'),
    acrossSections: ids('agent'),
    keyboard: ids('sidebar'),
    nothing: ids('zebra'),
    blank: ids('   '),
  }).toMatchInlineSnapshot(`
    {
      "acrossSections": [
        "notifications",
        "key-palette",
        "key-new-chat",
        "key-new-agent",
        "key-usage",
        "key-filter-agents",
        "key-binding",
        "key-inspector",
        "vault",
        "server",
        "invite",
        "data-folder",
      ],
      "blank": [],
      "keyboard": [
        "key-toggle-sidebar",
        "key-filter-agents",
      ],
      "motion": [
        {
          "rows": [
            "reduce-motion",
          ],
          "section": "appearance",
        },
      ],
      "nothing": [],
      "words": [
        "theme",
      ],
    }
  `);
});

it('finds Message color by its label, description, and search keywords', () => {
  expect({
    bubble: ids('bubble'),
    messageColor: ids('message color'),
    chatColor: ids('chat color'),
    matchBot: ids('match bot'),
  }).toEqual({
    bubble: ['message-color'],
    messageColor: ['message-color'],
    chatColor: ['message-color'],
    matchBot: ['message-color'],
  });
});

it('opens a deep link at its section, at its row when the row is in that section, or at an item inside it', () => {
  expect({
    section: targetOf('chat'),
    row: targetOf('appearance/theme'),
    keyRow: targetOf('keyboard/key-escape'),
    wrongSection: targetOf('about/theme'),
    unknownRow: targetOf('appearance/density'),
    provider: targetOf('providers/provider-openai'),
  }).toEqual({
    section: { section: 'chat', row: null, item: null },
    row: { section: 'appearance', row: 'theme', item: null },
    keyRow: { section: 'keyboard', row: 'key-escape', item: null },
    wrongSection: { section: 'about', row: null, item: 'theme' },
    unknownRow: { section: 'appearance', row: null, item: 'density' },
    provider: { section: 'providers', row: null, item: 'provider-openai' },
  });
});

it('writes each key row for macOS and elsewhere, following Send with', () => {
  const table = (platform: 'mac' | 'other', sendWith: 'enter' | 'mod-enter') => KEY_ROWS.map(({ id, entry }) => `${entry.label}: ${keysOf(id, platform, sendWith)}`);
  expect({ mac: table('mac', 'enter'), other: table('other', 'enter'), macModEnter: table('mac', 'mod-enter').slice(-4, -2) }).toMatchInlineSnapshot(`
    {
      "mac": [
        "Command palette: ⌘K",
        "New chat: ⌘N",
        "New agent: ⇧⌘N",
        "Settings: ⌘,",
        "Usage: ⌘U",
        "Toggle sidebar: ⌘B",
        "Filter agents: ⇧⌘F",
        "Extensions: ⇧⌘X",
        "Find in chat: ⌘F",
        "Model and access: ⇧⌘M",
        "Agent Inspector: ⌘I",
        "Send message: Enter",
        "New line: ⇧Enter",
        "Search: /",
        "Close: Esc",
      ],
      "macModEnter": [
        "Send message: ⌘Enter",
        "New line: Enter",
      ],
      "other": [
        "Command palette: Ctrl+K",
        "New chat: Ctrl+N",
        "New agent: Ctrl+Shift+N",
        "Settings: Ctrl+,",
        "Usage: Ctrl+U",
        "Toggle sidebar: Ctrl+B",
        "Filter agents: Ctrl+Shift+F",
        "Extensions: Ctrl+Shift+X",
        "Find in chat: Ctrl+F",
        "Model and access: Ctrl+Shift+M",
        "Agent Inspector: Ctrl+I",
        "Send message: Enter",
        "New line: Shift+Enter",
        "Search: /",
        "Close: Esc",
      ],
    }
  `);
});
