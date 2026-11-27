import { expect, it } from 'vitest';
import { ariaShortcut, isSearchPress, isSendPress, SHORTCUTS, shortcutLabel, shortcutOf, type KeyPress, type ShortcutId } from './keys.ts';

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

it('maps ⌘K, ⌘N, ⇧⌘N, ⌘, ⌘U, ⌘B, ⇧⌘F and ⇧⌘X on macOS, and the Ctrl forms elsewhere', () => {
  expect({
    mac: [
      shortcutOf(press('k', { metaKey: true }), 'mac'),
      shortcutOf(press('n', { metaKey: true }), 'mac'),
      shortcutOf(press('N', { metaKey: true, shiftKey: true }), 'mac'),
      shortcutOf(press(',', { metaKey: true }), 'mac'),
      shortcutOf(press('u', { metaKey: true }), 'mac'),
      shortcutOf(press('b', { metaKey: true }), 'mac'),
      shortcutOf(press('F', { metaKey: true, shiftKey: true }), 'mac'),
      shortcutOf(press('X', { metaKey: true, shiftKey: true }), 'mac'),
    ],
    other: [shortcutOf(press('K', { ctrlKey: true }), 'other'), shortcutOf(press('n', { ctrlKey: true }), 'other'), shortcutOf(press('B', { ctrlKey: true }), 'other')],
  }).toEqual({
    mac: ['palette', 'new-chat', 'new-agent', 'settings', 'usage', 'toggle-sidebar', 'filter-agents', 'extensions'],
    other: ['palette', 'new-chat', 'toggle-sidebar'],
  });
});

it('ignores the other platform’s modifier, Alt chords, plain keys and IME composition', () => {
  expect([
    shortcutOf(press('n', { ctrlKey: true }), 'mac'),
    shortcutOf(press('n', { metaKey: true }), 'other'),
    shortcutOf(press('n', { metaKey: true, altKey: true }), 'mac'),
    shortcutOf(press('n'), 'mac'),
    shortcutOf(press('g', { metaKey: true }), 'mac'),
    shortcutOf(press('n', { metaKey: true, isComposing: true }), 'mac'),
  ]).toEqual([null, null, null, null, null, null]);
});

it('labels every shortcut for tooltips and aria-keyshortcuts', () => {
  const ids = Object.keys(SHORTCUTS).filter((id): id is ShortcutId => id in SHORTCUTS);
  expect(Object.fromEntries(ids.map((id) => [id, [shortcutLabel(id, 'mac'), shortcutLabel(id, 'other'), ariaShortcut(id, 'mac')]]))).toMatchInlineSnapshot(`
    {
      "binding": [
        "⇧⌘M",
        "Ctrl+Shift+M",
        "Meta+Shift+M",
      ],
      "extensions": [
        "⇧⌘X",
        "Ctrl+Shift+X",
        "Meta+Shift+X",
      ],
      "filter-agents": [
        "⇧⌘F",
        "Ctrl+Shift+F",
        "Meta+Shift+F",
      ],
      "find": [
        "⌘F",
        "Ctrl+F",
        "Meta+F",
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
      "palette": [
        "⌘K",
        "Ctrl+K",
        "Meta+K",
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
      "usage": [
        "⌘U",
        "Ctrl+U",
        "Meta+U",
      ],
    }
  `);
});

it('sends on Enter or ⌘Enter by default and only on ⌘Enter with Send with ⌘Enter; ⇧Enter, Alt and IME never send', () => {
  const presses: Readonly<Record<string, KeyPress>> = {
    Enter: press('Enter'),
    'Mod+Enter': press('Enter', { metaKey: true }),
    'Ctrl+Enter': press('Enter', { ctrlKey: true }),
    'Shift+Enter': press('Enter', { shiftKey: true }),
    'Alt+Enter': press('Enter', { altKey: true }),
    'Enter (IME)': press('Enter', { isComposing: true }),
    a: press('a'),
  };
  const sends = (sendWith: 'enter' | 'mod-enter') => Object.entries(presses).filter(([, each]) => isSendPress(each, sendWith, 'mac')).map(([name]) => name);
  expect({
    enter: sends('enter'),
    modEnter: sends('mod-enter'),
    otherModEnter: Object.entries(presses).filter(([, each]) => isSendPress(each, 'mod-enter', 'other')).map(([name]) => name),
  }).toEqual({ enter: ['Enter', 'Mod+Enter'], modEnter: ['Mod+Enter'], otherModEnter: ['Ctrl+Enter'] });
});

it('focuses settings search on a bare / outside a text field only', () => {
  expect([
    isSearchPress(press('/'), false),
    isSearchPress(press('/'), true),
    isSearchPress(press('/', { metaKey: true }), false),
    isSearchPress(press('/', { isComposing: true }), false),
    isSearchPress(press('?', { shiftKey: true }), false),
  ]).toEqual([true, false, false, false, false]);
});
