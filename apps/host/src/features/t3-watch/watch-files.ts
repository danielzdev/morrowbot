import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { FileCursor } from './ports.ts';

export const REQUESTS_FILE = 'requests.jsonl';
export const CURRENT_WATCHES_FILE = 'current-watches.json';
/** The orchestrator appends acks here when it cannot reach the host API. */
export const ACKS_FILE = 'acks.jsonl';
/** The orchestrator's own durable record of what it handled; the host never reads it. */
export const HANDLED_FILE = 'handled.jsonl';

export type NewLines =
  | { readonly kind: 'missing' }
  | { readonly kind: 'lines'; readonly lines: readonly string[]; readonly cursor: FileCursor };

const NEWLINE = 0x0a;
/** Read at most this much per tick, so a huge file is taken in steps instead of all at once. */
const MAX_READ_BYTES = 1024 * 1024;

/**
 * The complete lines appended to `file` since `cursor`. A different inode (the file was replaced) or a file shorter
 * than the cursor (it was truncated) starts again from the top. A last line without its newline is left for later.
 */
export async function readNewLines(file: string, cursor: FileCursor | undefined): Promise<NewLines> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  try {
    const stats = await handle.stat({ bigint: true });
    const inode = stats.ino.toString();
    const size = Number(stats.size);
    const start = cursor?.inode === inode && cursor.offset <= size ? cursor.offset : 0;
    const length = Math.min(size - start, MAX_READ_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = length === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, length, start);
    const end = buffer.subarray(0, bytesRead).lastIndexOf(NEWLINE);
    if (end < 0) {
      return bytesRead === MAX_READ_BYTES
        ? { kind: 'lines', lines: [buffer.toString('utf8')], cursor: { inode, offset: start + bytesRead } }
        : { kind: 'lines', lines: [], cursor: { inode, offset: start } };
    }
    const lines = buffer
      .subarray(0, end)
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    return { kind: 'lines', lines, cursor: { inode, offset: start + end + 1 } };
  } finally {
    await handle.close();
  }
}

/**
 * Rewrites `current-watches.json` (each thread id to its current watch id) in one step: written beside it, then
 * renamed over it, so a reader sees the old map or the new one, never half of one.
 */
export function writeCurrentWatches(dir: string, threads: ReadonlyMap<string, string>): void {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, CURRENT_WATCHES_FILE);
  const temporary = `${target}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ threads: Object.fromEntries(threads) }, null, 2)}\n`);
  renameSync(temporary, target);
}
