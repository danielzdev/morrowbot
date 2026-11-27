import { constants } from 'node:fs';
import { access, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reads a text file of at most `maxBytes`. Returns null when it does not exist (ENOENT).
 * Throws when it exists but cannot be read, or is larger than `maxBytes`.
 */
export async function readOptionalFile(file: string, options: { readonly maxBytes: number }): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  try {
    const buffer = Buffer.alloc(options.maxBytes + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > options.maxBytes) throw new Error(`${file} is larger than ${String(options.maxBytes)} bytes`);
    }
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Lists the names in a directory, sorted. Returns null when it does not exist (ENOENT). Throws when it cannot be read. */
export async function listDirectory(dir: string): Promise<string[] | null> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export type Executable =
  | { readonly kind: 'found'; readonly path: string; readonly mtimeMs: number; readonly size: number }
  | { readonly kind: 'missing' };

/**
 * Finds an executable file: `command` itself when it contains a path separator, otherwise the first
 * match in `pathValue` (the plugin's `PATH`). Its mtime and size identify the installed version for caching.
 */
export async function statExecutable(command: string, pathValue: string): Promise<Executable> {
  const candidates = command.includes('/') || command.includes('\\')
    ? [path.resolve(command)]
    : pathValue.split(path.delimiter).filter((dir) => dir !== '').map((dir) => path.join(dir, command));
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, constants.X_OK);
      return { kind: 'found', path: candidate, mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      continue;
    }
  }
  return { kind: 'missing' };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
