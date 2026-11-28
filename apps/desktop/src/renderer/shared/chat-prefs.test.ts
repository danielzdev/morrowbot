import { afterEach, expect, it, vi } from 'vitest';
import { createChatPrefs } from './chat-prefs.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const savedAs = (raw: string | null): void => {
  const saved = new Map(raw === null ? [] : [['morrowbot.chat', raw]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
};

it('hides tool activity on a fresh install and for prefs saved before the setting, keeping what they chose', () => {
  savedAs(null);
  const fresh = createChatPrefs().state.get();
  savedAs(JSON.stringify({ sendWith: 'mod-enter', notify: 'off' }));
  const older = createChatPrefs().state.get();
  savedAs(JSON.stringify({ sendWith: 'enter', notify: 'on', toolActivity: 'on' }));
  const chosen = createChatPrefs().state.get();
  expect({ fresh, older, chosen }).toMatchInlineSnapshot(`
    {
      "chosen": {
        "notify": "on",
        "sendWith": "enter",
        "toolActivity": "on",
      },
      "fresh": {
        "notify": "on",
        "sendWith": "enter",
        "toolActivity": "off",
      },
      "older": {
        "notify": "off",
        "sendWith": "mod-enter",
        "toolActivity": "off",
      },
    }
  `);
});
