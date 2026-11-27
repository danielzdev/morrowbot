/** The app's global shortcuts (spec §1.5). ⌘ on macOS is Ctrl elsewhere. */
export type ShortcutId = 'new-chat' | 'new-agent' | 'settings' | 'toggle-sidebar' | 'filter-agents' | 'extensions';

export type Platform = 'mac' | 'other';

interface Chord {
  readonly key: string;
  readonly shift: boolean;
}

export const SHORTCUTS: Readonly<Record<ShortcutId, Chord>> = {
  'new-chat': { key: 'n', shift: false },
  'new-agent': { key: 'n', shift: true },
  settings: { key: ',', shift: false },
  'toggle-sidebar': { key: 'b', shift: false },
  'filter-agents': { key: 'f', shift: true },
  extensions: { key: 'x', shift: true },
};

/** What the matcher reads from a keyboard event. */
export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
}

export function platformOf(navigatorPlatform: string): Platform {
  return /mac/i.test(navigatorPlatform) ? 'mac' : 'other';
}

/** The shortcut this key press triggers, or null. Only the platform's own modifier counts. */
export function shortcutOf(press: KeyPress, platform: Platform): ShortcutId | null {
  if (press.isComposing === true || press.altKey) return null;
  const mod = platform === 'mac' ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!mod) return null;
  const key = press.key.toLowerCase();
  for (const [id, chord] of Object.entries(SHORTCUTS)) {
    if (chord.key === key && chord.shift === press.shiftKey && isShortcutId(id)) return id;
  }
  return null;
}

function isShortcutId(id: string): id is ShortcutId {
  return id in SHORTCUTS;
}

/** How a shortcut is written in tooltips and menus: "⇧⌘N" on macOS, "Ctrl+Shift+N" elsewhere. */
export function shortcutLabel(id: ShortcutId, platform: Platform): string {
  const { key, shift } = SHORTCUTS[id];
  const shown = key.toUpperCase();
  return platform === 'mac' ? `${shift ? '⇧' : ''}⌘${shown}` : `Ctrl+${shift ? 'Shift+' : ''}${shown}`;
}

/** The `aria-keyshortcuts` value for a shortcut. */
export function ariaShortcut(id: ShortcutId, platform: Platform): string {
  const { key, shift } = SHORTCUTS[id];
  return `${platform === 'mac' ? 'Meta' : 'Control'}+${shift ? 'Shift+' : ''}${key === ',' ? 'Comma' : key.toUpperCase()}`;
}

/** This window's platform. */
export const PLATFORM: Platform = typeof navigator === 'undefined' ? 'other' : platformOf(navigator.platform);
