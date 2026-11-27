import type { ComponentChildren } from 'preact';

/** The palette's groups, in the order they show (spec §3.5). */
export type PaletteGroup = 'actions' | 'agents' | 'chats' | 'settings';

export const GROUP_TITLES: Readonly<Record<PaletteGroup, string>> = {
  actions: 'Actions',
  agents: 'Agents',
  chats: 'Chats',
  settings: 'Settings',
};

const GROUP_ORDER: readonly PaletteGroup[] = ['actions', 'agents', 'chats', 'settings'];

/** At most this many rows per group, while searching and before. `settings` shows only while searching. */
const LIMITS: Readonly<Record<PaletteGroup, { readonly idle: number; readonly searching: number }>> = {
  actions: { idle: Infinity, searching: Infinity },
  agents: { idle: 8, searching: 8 },
  chats: { idle: 8, searching: 10 },
  settings: { idle: 0, searching: 8 },
};

/** One thing the palette can open or do. The app builds these; the palette only finds and runs them. */
export interface PaletteItem {
  /** Unique across the palette, such as `agent:<id>`. */
  readonly id: string;
  readonly group: PaletteGroup;
  readonly label: string;
  /** Quieter text after the label: a chat's agent, a setting's section. Searched too, ranked lower. */
  readonly detail: string;
  /** A shortcut such as "⌘N", or ''. */
  readonly hint: string;
  /** An icon or avatar before the label. */
  readonly leading: ComponentChildren;
  readonly run: () => void;
}

export interface PaletteSection {
  readonly group: PaletteGroup;
  readonly items: readonly PaletteItem[];
}

const isWordStart = (text: string, index: number): boolean => index === 0 || !/[\p{L}\p{N}]/u.test(text.charAt(index - 1));

/**
 * How well one query word matches `text` (any case); null when it does not. A plain substring scores
 * highest, more at a word start. Otherwise each letter must start a word or follow the letter before
 * it, so "rb" finds "Reading Buddy" and "nch" finds "New chat", but "read" does not find "Recheck Claude".
 */
export function fuzzyScore(word: string, text: string): number | null {
  const needle = word.toLocaleLowerCase();
  const hay = text.toLocaleLowerCase();
  if (needle === '') return 0;
  const exact = hay.indexOf(needle);
  if (exact !== -1) return 100 + needle.length * 4 + (isWordStart(hay, exact) ? 50 : 0) - exact * 0.1;
  let score = 0;
  let from = 0;
  for (const char of needle) {
    let at = from > 0 && hay.charAt(from) === char ? from : -1;
    if (at === -1) {
      for (let index = from; index < hay.length; index++) {
        if (hay.charAt(index) === char && isWordStart(hay, index)) {
          at = index;
          break;
        }
      }
    }
    if (at === -1) return null;
    score += at === from && from > 0 ? 5 : 3;
    from = at + 1;
  }
  return score;
}

/** An item's score for every word of `query`; null when any word misses both the label and the detail. */
export function itemScore(item: Pick<PaletteItem, 'label' | 'detail'>, query: string): number | null {
  const words = query.split(/\s+/).filter((word) => word !== '');
  let total = 0;
  for (const word of words) {
    const label = fuzzyScore(word, item.label);
    const detail = item.detail === '' ? null : fuzzyScore(word, item.detail);
    if (label === null && detail === null) return null;
    total += Math.max(label ?? -Infinity, (detail ?? -Infinity) - 30);
  }
  return total;
}

/**
 * The rows to show for `query`, by group in palette order. A blank query lists actions, agents and
 * recent chats as given; otherwise each group keeps its matches, best first (ties keep their order).
 */
export function searchPalette(items: readonly PaletteItem[], query: string): readonly PaletteSection[] {
  const searching = query.trim() !== '';
  return GROUP_ORDER.map((group) => {
    const limit = searching ? LIMITS[group].searching : LIMITS[group].idle;
    const mine = items.filter((item) => item.group === group);
    const ranked = searching
      ? mine
          .map((item, order) => ({ item, order, score: itemScore(item, query) }))
          .filter((each): each is { item: PaletteItem; order: number; score: number } => each.score !== null)
          .sort((a, b) => b.score - a.score || a.order - b.order)
          .map(({ item }) => item)
      : mine;
    return { group, items: ranked.slice(0, limit) };
  }).filter(({ items: shown }) => shown.length > 0);
}

/** The row after (`step` 1) or before (-1) `index`, wrapping; 0 when the list is empty. */
export function stepActive(index: number, step: 1 | -1, count: number): number {
  if (count === 0) return 0;
  return (index + step + count) % count;
}
