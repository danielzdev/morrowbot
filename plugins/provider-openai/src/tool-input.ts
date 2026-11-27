import type { TurnChunk } from '@morrowbot/plugin-sdk';
import type { ThreadItem } from './protocol.ts';

type ToolInput = Extract<TurnChunk, { kind: 'tool-start' }>['input'];

const MAX_INPUT_CHARS = 4096;
const SECRET = /\b([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer\s+)\S+/gi;

/** A tool call as the user sees it: a short name and its input, home shown as `~`, secrets masked, at most 4 KB. */
export function describeTool(item: ThreadItem, home: string | null): { readonly name: string; readonly input: ToolInput } | null {
  const show = (text: string): string => clip(mask(tilde(text, home)));
  switch (item.type) {
    case 'commandExecution':
      return { name: 'Shell', input: { command: show(item.command ?? '') } };
    case 'fileChange':
      return { name: 'Edit', input: { files: (item.changes ?? []).slice(0, 50).map((change) => show(change.path)) } };
    case 'mcpToolCall':
      return { name: `${item.server ?? 'mcp'}.${item.tool ?? 'tool'}`, input: {} };
    case 'dynamicToolCall':
      return { name: item.tool ?? 'Tool', input: {} };
    case 'webSearch':
      return { name: 'WebSearch', input: item.query ? { query: show(item.query) } : {} };
    case 'imageView':
      return { name: 'ViewImage', input: { path: show(item.path ?? '') } };
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

function clip(text: string): string {
  return text.length <= MAX_INPUT_CHARS - 64 ? text : `${text.slice(0, MAX_INPUT_CHARS - 65)}…`;
}
