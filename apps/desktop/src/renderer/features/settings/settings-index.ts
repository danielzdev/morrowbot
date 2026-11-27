import type { SendWith } from '../../shared/chat-prefs.ts';
import { sendKeyLabels, shortcutLabel, SHORTCUTS, type Platform, type ShortcutId } from '../../shared/keys.ts';
import type { IconName } from '../../shared/ui/Icon.tsx';
import type { SettingsNavGroup } from '../../shared/ui/SettingsShell.tsx';

export type SettingsSection = 'general' | 'appearance' | 'chat' | 'keyboard' | 'providers' | 'usage' | 'about';

/** A place in Settings: a section, or a row inside it (`'appearance/theme'`). Sidebar, palette and banners all open these. */
export type SettingsLink = SettingsSection | `${SettingsSection}/${string}`;

export interface SettingsTarget {
  readonly section: SettingsSection;
  /** The row to scroll to, focus and flash; null for the top of the section. */
  readonly row: string | null;
  /** The rest of a link that names no row: an item the section opens, such as a provider (`providers/provider-openai`). */
  readonly item: string | null;
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
  providers: { title: 'Providers', icon: 'provider' },
  usage: { title: 'Usage', icon: 'gauge' },
  about: { title: 'About', icon: 'info' },
};

const navItem = (id: SettingsSection) => ({ id, label: SECTIONS[id].title, icon: SECTIONS[id].icon });

export const NAV: readonly SettingsNavGroup[] = [
  { label: 'App', items: [navItem('general'), navItem('appearance'), navItem('chat'), navItem('keyboard')] },
  { label: 'Connections', items: [navItem('providers'), navItem('usage')] },
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
  providers: row('providers', 'providers', 'AI providers', 'Claude, Codex, Antigravity, OpenCode and community engines: set up, sign in, check status and change settings.'),
  version: row('about', 'version', 'MorrowBot', 'Apache License 2.0 · Published by Legendary Koi'),
  dataFolder: row('about', 'data-folder', 'Data folder', 'Where MorrowBot keeps your agents and chats.'),
  licences: row('about', 'licences', 'Third-party licences', 'Open-source components that ship inside MorrowBot.'),
};

/** Keys that work in one place rather than everywhere. */
export type ContextKey = 'send' | 'new-line' | 'settings-search' | 'escape';
export type KeyRowId = ShortcutId | ContextKey;

const SHORTCUT_COPY: Readonly<Record<ShortcutId, readonly [label: string, description: string]>> = {
  palette: ['Command palette', 'Jump to an agent, a chat, a setting or an action.'],
  'new-chat': ['New chat', 'Start a new chat with the current agent.'],
  'new-agent': ['New agent', 'Create an agent.'],
  settings: ['Settings', 'Open these settings.'],
  usage: ['Usage', 'See plan limits and the tokens your agents used.'],
  'toggle-sidebar': ['Toggle sidebar', 'Shrink the sidebar to a rail of avatars, or expand it again.'],
  'filter-agents': ['Filter agents', 'Find an agent in the sidebar by name.'],
  extensions: ['Extensions', 'Open Extensions: your plugins, connectors and the Marketplace.'],
  find: ['Find in chat', 'Search the open chat. Enter and Shift+Enter move between matches.'],
  binding: ['Model and access', "Change the current agent's model, effort and access."],
};

const CONTEXT_COPY: Readonly<Record<ContextKey, readonly [label: string, description: string]>> = {
  send: ['Send message', 'In the message box. Change it under Chat › Send with.'],
  'new-line': ['New line', 'In the message box.'],
  'settings-search': ['Search', 'In Settings or Extensions, outside a text field: focus search.'],
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
    case 'palette':
    case 'new-chat':
    case 'new-agent':
    case 'settings':
    case 'usage':
    case 'toggle-sidebar':
    case 'filter-agents':
    case 'extensions':
    case 'find':
    case 'binding':
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

/** Where a link opens. A rest that names no row of the section is an item inside it, opened at the top. */
export function targetOf(link: SettingsLink): SettingsTarget {
  const slash = link.indexOf('/');
  const head = slash === -1 ? link : link.slice(0, slash);
  const section = isSection(head) ? head : 'general';
  const rest = slash === -1 ? null : link.slice(slash + 1);
  const known = INDEX.some((entry) => entry.section === section && entry.id === rest);
  return { section, row: known ? rest : null, item: known || rest === '' ? null : rest };
}

/** A place in Settings the command palette can open: a section, or one row. */
export interface SettingsDestination {
  readonly link: SettingsLink;
  readonly label: string;
  readonly description: string;
  /** The section's title, shown beside a row. */
  readonly section: string;
}

/** Every section, then every row, as palette entries. */
export const DESTINATIONS: readonly SettingsDestination[] = [
  ...SECTION_ORDER.map((section) => ({ link: section, label: SECTIONS[section].title, description: '', section: 'Settings' })),
  ...INDEX.map((entry): SettingsDestination => ({ link: `${entry.section}/${entry.id}`, label: entry.label, description: entry.description, section: SECTIONS[entry.section].title })),
];
