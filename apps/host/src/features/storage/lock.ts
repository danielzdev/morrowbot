import { DatabaseSync } from 'node:sqlite';

/** Another host process holds this data directory. */
export class DataDirLockedError extends Error {
  constructor(dataDir: string) {
    super(`Another Ori Kami host is using ${dataDir}`);
    this.name = 'DataDirLockedError';
  }
}

export interface DataDirLock {
  release(): void;
}

/**
 * Takes the data directory's exclusive host lock: a separate SQLite file holding `BEGIN IMMEDIATE`
 * for the life of the process, with `busy_timeout = 0` so a second host fails at once instead of waiting.
 * The OS drops the lock when the process exits. `file` should sit in the canonical (realpath) data directory.
 */
export function lockDataDir(file: string, dataDir: string): DataDirLock {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    db.close();
    if (error instanceof Error && /locked|busy/i.test(error.message)) throw new DataDirLockedError(dataDir);
    throw error;
  }
  return {
    release: () => {
      db.close();
    },
  };
}
