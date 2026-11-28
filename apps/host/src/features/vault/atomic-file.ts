import { randomBytes } from 'node:crypto';
import { link, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const TEMP = /^vault[\w.-]*\.[0-9a-f]{12}\.tmp$/;

/** Writes `data` to a new owner-only temporary file beside `file` and flushes it to disk; returns its path. */
async function flushedTemp(file: string, data: string): Promise<string> {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return temp;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Flushes the folder's entry list, so a finished rename or link survives a power cut. Never throws: the rename has
 * already happened, and a caller told it failed would undo a change that is in place. Windows cannot open a folder.
 */
async function syncFolder(file: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    const handle = await open(path.dirname(file), 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    return;
  }
}

/**
 * Replaces `file` with `data` so a reader, or a crash at any moment, sees either the old file or the
 * whole new one: the data goes to a new temporary file beside it (owner-only), is flushed to disk, and
 * is then renamed over `file`.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const temp = await flushedTemp(file, data);
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await syncFolder(file);
}

/** Like `writeFileAtomic`, but only when `file` does not exist yet: false, changing nothing, when it does. */
export async function writeFileOnce(file: string, data: string): Promise<boolean> {
  const temp = await flushedTemp(file, data);
  try {
    await link(temp, file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
  await syncFolder(file);
  return true;
}

/** Deletes the temporary files a crash mid-write left in `dir`: stale copies of sealed secrets or of a key file. */
export async function removeStaleTemps(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => []);
  await Promise.all(names.filter((name) => TEMP.test(name)).map((name) => rm(path.join(dir, name), { force: true })));
}
