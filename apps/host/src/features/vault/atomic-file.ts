import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';

/**
 * Replaces `file` with `data` so a reader, or a crash at any moment, sees either the old file or the
 * whole new one: the data goes to a new temporary file beside it (owner-only), is flushed to disk, and
 * is then renamed over `file`.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
