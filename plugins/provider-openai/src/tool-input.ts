import type { TurnChunk } from '@morrowbot/plugin-sdk';
import type { ThreadItem } from './protocol.ts';

type ToolInput = Extract<TurnChunk, { kind: 'tool-start' }>['input'];

const MAX_INPUT_CHARS = 4096;
const SECRET = /\b([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer\s+)\S+/gi;

/** A tool call as the user sees it: a short name and its input, home shown as `~`, secrets masked, at most 4 KB of JSON. */
export function describeTool(item: ThreadItem, home: string | null): { readonly name: string; readonly input: ToolInput } | null {
  if (item.id === '') return null;
  const show = (text: string): string => mask(tilde(text, home));
  switch (item.type) {
    case 'commandExecution':
      return { name: 'Shell', input: fitText('command', show(item.command ?? '')) };
    case 'fileChange':
      return { name: 'Edit', input: { files: fitList((item.changes ?? []).map((change) => show(change.path))) } };
    case 'mcpToolCall':
      return { name: `${nonEmpty(item.server, 'mcp')}.${nonEmpty(item.tool, 'tool')}`, input: {} };
    case 'dynamicToolCall':
      return { name: nonEmpty(item.tool, 'Tool'), input: {} };
    case 'webSearch':
      return { name: 'WebSearch', input: item.query ? fitText('query', show(item.query)) : {} };
    case 'imageView':
      return { name: 'ViewImage', input: fitText('path', show(item.path ?? '')) };
    default:
      return null;
  }
}

/** `text` with the home folder shown as `~`. */
export function tilde(text: string, home: string | null): string {
  const dir = home?.replace(/\/+$/, '') ?? '';
  if (dir === '') return text;
  return text === dir ? '~' : text.split(`${dir}/`).join('~/');
}

function mask(text: string): string {
  return text.replace(SECRET, '$1$2***').replace(BEARER, '$1***');
}

function nonEmpty(text: string | null | undefined, fallback: string): string {
  return text === null || text === undefined || text === '' ? fallback : text;
}

const fits = (input: ToolInput): boolean => JSON.stringify(input).length <= MAX_INPUT_CHARS;

/** `{[key]: text}`, with the text cut (and marked with `…`) until its JSON fits. */
function fitText(key: string, text: string): ToolInput {
  if (fits({ [key]: text })) return { [key]: text };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits({ [key]: `${text.slice(0, middle)}…` })) low = middle;
    else high = middle - 1;
  }
  return { [key]: `${text.slice(0, low)}…` };
}

/** As many of `items` as fit, each cut to 1 KB. */
function fitList(items: readonly string[]): string[] {
  const kept: string[] = [];
  for (const item of items) {
    const next = [...kept, item.length <= 1024 ? item : `${item.slice(0, 1023)}…`];
    if (!fits({ files: next })) break;
    kept.push(next[next.length - 1] ?? item);
  }
  return kept;
}
