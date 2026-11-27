import type { SendWith } from '../../shared/chat-prefs.ts';
import { sendKeyLabels, shortcutLabel, SHORTCUTS, type Platform, type ShortcutId } from '../../shared/keys.ts';
import type { IconName } from '../../shared/ui/Icon.tsx';
import type { SettingsNavGroup } from '../../shared/ui/SettingsShell.tsx';

export type SettingsSection = 'general' | 'appearance' | 'chat' | 'keyboard' | 'about';

/** A place in Settings: a section, or a row inside it (`'appearance/theme'`). Sidebar, palette and banners all open these. */
export type SettingsLink = SettingsSection | `${SettingsSection}/${string}`;

export interface SettingsTarget {
  readonly section: SettingsSection;
  /** The row to scroll to, focus and flash; null for the top of the section. */
  readonly row: string | null;
}

/** One settings row as search and the sections both see it: the row renders exactly this label and description. */
export interface SettingEntry {
  readonly id: string;
  readonly section: SettingsSection;
  readonly label: string;
  readonly description: string;
}

export const SECTIONS: Readonly<Record<SettingsSection, { readonly title: string; readonly icon: IconName }>> = {
  general: { title: 'General', icon: 'settings' },
  appearance: { title: 'Appearance', icon: 'palette' },
  chat: { title: 'Chat', icon: 'chat' },
  keyboard: { title: 'Keyboard', icon: 'keyboard' },
  about: { title: 'About', icon: 'info' },
};

const navItem = (id: SettingsSection) => ({ id, label: SECTIONS[id].title, icon: SECTIONS[id].icon });

export const NAV: readonly SettingsNavGroup[] = [
  { label: 'App', items: [navItem('general'), navItem('appearance'), navItem('chat'), navItem('keyboard')] },
  { label: null, items: [navItem('about')] },
];

const SECTION_ORDER: readonly SettingsSection[] = NAV.flatMap((group) => group.items.map(({ id }) => id)).filter(isSection);

export function isSection(id: string): id is SettingsSection {
  return Object.hasOwn(SECTIONS, id);
}

const row = (section: SettingsSection, id: string, label: string, description: string): SettingEntry => ({ id, section, label, description });

/** The rows of every section except Keyboard, in the order they render. */
export const ROWS = {
  openAtLogin: row('general', 'open-at-login', 'Open at login', 'Start MorrowBot when you log in to this computer.'),
  theme: row('appearance', 'theme', 'Theme', 'Follow the system, or always use light or dark.'),
  chatWidth: row('appearance', 'chat-width', 'Chat width', 'How wide the chat column gets: Normal is 720px, Wide is 920px.'),
  reduceMotion: row('appearance', 'reduce-motion', 'Reduce motion', "On stills avatars and slide-ins. Your system's reduce-motion setting always applies."),
  sendWith: row('chat', 'send-with', 'Send with', 'Which key sends your message. Shift+Enter always starts a new line.'),
  version: row('about', 'version', 'MorrowBot', 'Apache License 2.0 · Published by Legendary Koi'),
  dataFolder: row('about', 'data-folder', 'Data folder', 'Where MorrowBot keeps your agents and chats.'),
  licences: row('about', 'licences', 'Third-party licences', 'Open-source components that ship inside MorrowBot.'),
};

/** Keys that work in one place rather than everywhere. */
export type ContextKey = 'send' | 'new-line' | 'settings-search' | 'escape';
export type KeyRowId = ShortcutId | ContextKey;

const SHORTCUT_COPY: Readonly<Record<ShortcutId, readonly [label: string, description: string]>> = {
  'new-chat': ['New chat', 'Start a new chat with the current agent.'],
  'new-agent': ['New agent', 'Create an agent.'],
  settings: ['Settings', 'Open these settings.'],
  'toggle-sidebar': ['Toggle sidebar', 'Shrink the sidebar to a rail of avatars, or expand it again.'],
  'filter-agents': ['Filter agents', 'Find an agent in the sidebar by name.'],
  extensions: ['Extensions', 'Open Extensions, where your plugins live.'],
  find: ['Find in chat', 'Search the open chat. Enter and Shift+Enter move between matches.'],
};

const CONTEXT_COPY: Readonly<Record<ContextKey, readonly [label: string, description: string]>> = {
  send: ['Send message', 'In the message box. Change it under Chat › Send with.'],
  'new-line': ['New line', 'In the message box.'],
  'settings-search': ['Search settings', 'In Settings, outside a text field.'],
  escape: ['Close', 'Esc closes the top menu, popover or dialog. While searching settings, it clears the search first.'],
};

const SHORTCUT_IDS = Object.keys(SHORTCUTS).filter((id): id is ShortcutId => id in SHORTCUT_COPY);
const CONTEXT_IDS: readonly ContextKey[] = ['send', 'new-line', 'settings-search', 'escape'];

export interface KeyRow {
  readonly id: KeyRowId;
  readonly entry: SettingEntry;
}

const keyRow = (id: KeyRowId, [label, description]: readonly [string, string]): KeyRow => ({ id, entry: row('keyboard', `key-${id}`, label, description) });

/** Settings › Keyboard: every global shortcut, then the keys that work in one place. A read-only list (spec §6.1). */
export const KEY_ROWS: readonly KeyRow[] = [
  ...SHORTCUT_IDS.map((id) => keyRow(id, SHORTCUT_COPY[id])),
  ...CONTEXT_IDS.map((id) => keyRow(id, CONTEXT_COPY[id])),
];

/** How a key row's keys are written on this platform. */
export function keysOf(id: KeyRowId, platform: Platform, sendWith: SendWith): string {
  switch (id) {
    case 'send':
      return sendKeyLabels(sendWith, platform).send;
    case 'new-line':
      return sendKeyLabels(sendWith, platform).newLine;
    case 'settings-search':
      return '/';
    case 'escape':
      return 'Esc';
    case 'new-chat':
    case 'new-agent':
    case 'settings':
    case 'toggle-sidebar':
    case 'filter-agents':
    case 'extensions':
    case 'find':
      return shortcutLabel(id, platform);
  }
}

/** Every settings row, in section order then render order. Search reads only this. */
export const INDEX: readonly SettingEntry[] = [...Object.values(ROWS), ...KEY_ROWS.map(({ entry }) => entry)].sort(
  (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
);

export interface SearchGroup {
  readonly section: SettingsSection;
  readonly entries: readonly SettingEntry[];
}

/** The rows whose label or description holds every word of `query` (any case), grouped by section in nav order. */
export function searchSettings(query: string, index: readonly SettingEntry[] = INDEX): readonly SearchGroup[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  const found = index.filter((entry) => {
    const text = `${entry.label} ${entry.description}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
  return SECTION_ORDER.map((section) => ({ section, entries: found.filter((entry) => entry.section === section) })).filter(({ entries }) => entries.length > 0);
}

/** Where a link opens. An unknown row opens its section at the top. */
export function targetOf(link: SettingsLink): SettingsTarget {
  const slash = link.indexOf('/');
  const head = slash === -1 ? link : link.slice(0, slash);
  const section = isSection(head) ? head : 'general';
  const rowId = slash === -1 ? null : link.slice(slash + 1);
  const known = INDEX.some((entry) => entry.section === section && entry.id === rowId);
  return { section, row: known ? rowId : null };
}
