import type { TurnChunk } from '@morrowbot/plugin-sdk';

type ToolInput = Extract<TurnChunk, { kind: 'tool-start' }>['input'];

/** The contract's limit on a tool input's JSON. */
const MAX_INPUT_CHARS = 4096;

/**
 * A tool call's input as the user sees it: the home folder shown as `~`, and at most 4 KB of JSON.
 * Larger input becomes the start of its JSON as one string.
 */
export function toolInput(input: ToolInput, home: string | null): ToolInput {
  const shown = withTilde(input, home);
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

function withTilde(value: ToolInput, home: string | null): ToolInput {
  if (typeof value === 'string') return tilde(value, home);
  if (Array.isArray(value)) return value.map((item) => withTilde(item, home));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withTilde(item, home)]));
}

/** `text` with the home folder shown as `~`. */
export function tilde(text: string, home: string | null): string {
  if (home === null || home === '' || home === '/') return text;
  return text === home ? '~' : text.split(`${home}/`).join('~/');
}
