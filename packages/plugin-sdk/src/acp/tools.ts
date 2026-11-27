import type { TurnChunk } from '@morrowbot/contracts';

type ToolInput = Extract<TurnChunk, { kind: 'tool-start' }>['input'];

/** Even escaped six-fold as JSON (`\u0000`), a title this long stays under the 4 KB a tool input may take. */
const MAX_TITLE_CHARS = 600;
const SECRET = /\b([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer\s+)\S+/gi;

const NAMES: Readonly<Record<string, string>> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Shell',
  think: 'Think',
  fetch: 'Fetch',
  switch_mode: 'SwitchMode',
};

/** A tool call as the user sees it: a short name and its title, home shown as `~`, secrets masked, well under 4 KB. */
export function describeTool(kind: string | null, title: string | null, home: string | null): { readonly name: string; readonly label: string; readonly input: ToolInput } {
  const name = NAMES[kind ?? ''] ?? 'Tool';
  if (title === null || title === '') return { name, label: name, input: {} };
  const masked = mask(tilde(title, home));
  const shown = masked.length <= MAX_TITLE_CHARS ? masked : `${masked.slice(0, MAX_TITLE_CHARS - 1)}…`;
  return { name, label: `${name} ${shown}`, input: { title: shown } };
}

/** `text` with the home folder shown as `~`. */
export function tilde(text: string, home: string | null): string {
  const dir = home?.replace(/\/+$/, '') ?? '';
  if (dir === '') return text;
  return text === dir ? '~' : text.split(`${dir}/`).join('~/');
}

/** `text` with tokens, passwords, keys and bearer credentials shown as `***`. */
export function mask(text: string): string {
  return text.replace(SECRET, '$1$2***').replace(BEARER, '$1***');
}
