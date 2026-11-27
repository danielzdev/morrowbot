import type { TurnChunk } from '@morrowbot/plugin-sdk';

type ToolInput = Extract<TurnChunk, { kind: 'tool-start' }>['input'];

/** The contract's limit on a tool input's JSON. */
const MAX_INPUT_CHARS = 4096;

/** What Write and Edit put in a file. It can hold secrets, so the user sees only its length. */
const FILE_TEXT_KEYS = new Set(['content', 'old_string', 'new_string']);

/**
 * A tool call's input as the user sees it: file text shown as its length, the home folder shown as
 * `~`, and at most 4 KB of JSON. Larger input becomes the start of its JSON as one string.
 */
export function toolInput(input: ToolInput, home: string | null): ToolInput {
  const shown = withTilde(masked(input), home);
  const json = JSON.stringify(shown);
  if (json.length <= MAX_INPUT_CHARS) return shown;
  let length = MAX_INPUT_CHARS;
  let summary = `${json.slice(0, length)}…`;
  while (JSON.stringify(summary).length > MAX_INPUT_CHARS) {
    length = Math.floor(length * 0.75);
    summary = `${json.slice(0, length)}…`;
  }
  return summary;
}

function masked(input: ToolInput): ToolInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, FILE_TEXT_KEYS.has(key) && typeof value === 'string' ? `(${String(value.length)} characters)` : value]),
  );
}

function withTilde(value: ToolInput, home: string | null): ToolInput {
  if (typeof value === 'string') return tilde(value, home);
  if (Array.isArray(value)) return value.map((item) => withTilde(item, home));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withTilde(item, home)]));
}

/** `text` with the home folder shown as `~`. */
export function tilde(text: string, home: string | null): string {
  const dir = home?.replace(/\/+$/, '') ?? '';
  if (dir === '') return text;
  return text === dir ? '~' : text.split(`${dir}/`).join('~/');
}
