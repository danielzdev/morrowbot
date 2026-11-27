import { expect, it } from 'vitest';
import { ariaShortcut, SHORTCUTS, shortcutLabel, shortcutOf, type KeyPress, type ShortcutId } from './keys.ts';

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

it('maps ⌘N, ⇧⌘N, ⌘, ⌘B and ⇧⌘F on macOS, and the Ctrl forms elsewhere', () => {
  expect({
    mac: [
      shortcutOf(press('n', { metaKey: true }), 'mac'),
      shortcutOf(press('N', { metaKey: true, shiftKey: true }), 'mac'),
      shortcutOf(press(',', { metaKey: true }), 'mac'),
      shortcutOf(press('b', { metaKey: true }), 'mac'),
      shortcutOf(press('F', { metaKey: true, shiftKey: true }), 'mac'),
    ],
    other: [shortcutOf(press('n', { ctrlKey: true }), 'other'), shortcutOf(press('B', { ctrlKey: true }), 'other')],
  }).toEqual({
    mac: ['new-chat', 'new-agent', 'settings', 'toggle-sidebar', 'filter-agents'],
    other: ['new-chat', 'toggle-sidebar'],
  });
});

it('ignores the other platform’s modifier, Alt chords, plain keys and IME composition', () => {
  expect([
    shortcutOf(press('n', { ctrlKey: true }), 'mac'),
    shortcutOf(press('n', { metaKey: true }), 'other'),
    shortcutOf(press('n', { metaKey: true, altKey: true }), 'mac'),
    shortcutOf(press('n'), 'mac'),
    shortcutOf(press('f', { metaKey: true }), 'mac'),
    shortcutOf(press('n', { metaKey: true, isComposing: true }), 'mac'),
  ]).toEqual([null, null, null, null, null, null]);
});

it('labels every shortcut for tooltips and aria-keyshortcuts', () => {
  const ids = Object.keys(SHORTCUTS).filter((id): id is ShortcutId => id in SHORTCUTS);
  expect(Object.fromEntries(ids.map((id) => [id, [shortcutLabel(id, 'mac'), shortcutLabel(id, 'other'), ariaShortcut(id, 'mac')]]))).toMatchInlineSnapshot(`
    {
      "filter-agents": [
        "⇧⌘F",
        "Ctrl+Shift+F",
        "Meta+Shift+F",
      ],
      "new-agent": [
        "⇧⌘N",
        "Ctrl+Shift+N",
        "Meta+Shift+N",
      ],
      "new-chat": [
        "⌘N",
        "Ctrl+N",
        "Meta+N",
      ],
      "settings": [
        "⌘,",
        "Ctrl+,",
        "Meta+Comma",
      ],
      "toggle-sidebar": [
        "⌘B",
        "Ctrl+B",
        "Meta+B",
      ],
    }
  `);
});
