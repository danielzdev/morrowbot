import type { Message } from '@morrowbot/contracts';
import { parseMarkdown, plainText } from './markdown.ts';
import type { ThreadView } from './thread-model.ts';

/** One message's text as the reader sees it, keyed like its `data-find-id`. */
export interface Searchable {
  readonly id: string;
  readonly text: string;
}

/** The `nth` match (from 0) inside the message with `id`. */
export interface FindMatch {
  readonly id: string;
  readonly nth: number;
}

/** The id the streaming reply's text carries. */
export const ACTIVE_ID = 'active-turn';

const MAX_MATCHES = 10_000;
const shownText = new WeakMap<Message, string>();

function textOf(message: Message): string {
  if (message.kind === 'user') return message.text;
  const cached = shownText.get(message);
  if (cached !== undefined) return cached;
  const text = plainText(parseMarkdown(message.text));
  shownText.set(message, text);
  return text;
}

/** Every loaded message (rendered or not) and the streaming reply, oldest first. */
export function searchableOf(view: ThreadView): Searchable[] {
  const items = view.messages.map((message) => ({ id: message.id, text: textOf(message) }));
  const active = view.activeTurn?.text ?? '';
  return active === '' ? items : [...items, { id: ACTIVE_ID, text: plainText(parseMarkdown(active)) }];
}

/** Offsets of each case-insensitive occurrence of `query` in `text`, without overlaps. */
export function occurrences(text: string, query: string): number[] {
  const needle = query.toLowerCase();
  if (needle === '') return [];
  const hay = text.toLowerCase();
  const found: number[] = [];
  for (let at = hay.indexOf(needle); at !== -1 && found.length < MAX_MATCHES; at = hay.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

/** Every match of `query`, in reading order. */
export function findMatches(items: readonly Searchable[], query: string): FindMatch[] {
  const matches: FindMatch[] = [];
  for (const item of items) {
    const count = occurrences(item.text, query).length;
    for (let nth = 0; nth < count && matches.length < MAX_MATCHES; nth += 1) matches.push({ id: item.id, nth });
  }
  return matches;
}

/** The match after (`step` 1) or before (-1) `current`, wrapping around. */
export function stepMatch(total: number, current: number, step: 1 | -1): number {
  if (total === 0) return 0;
  return (current + step + total) % total;
}
