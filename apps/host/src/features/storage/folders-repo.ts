import type { DatabaseSync } from 'node:sqlite';
import { Folder } from '@morrowbot/contracts';
import { z } from 'zod';

const FolderRow = z
  .object({ id: z.string(), name: z.string(), created_at: z.string() })
  .transform((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }))
  .pipe(Folder);

export interface FolderRepository {
  insert(folder: Folder): void;
  rename(id: string, name: string): Folder | undefined;
  /** Agents in the folder stay, outside any folder, with their revision bumped. */
  delete(id: string): boolean;
  get(id: string): Folder | undefined;
  list(): Folder[];
}

export function folderRepository(db: DatabaseSync): FolderRepository {
  const insert = db.prepare('INSERT INTO folders (id, name, created_at) VALUES (:id, :name, :createdAt)');
  const rename = db.prepare('UPDATE folders SET name = ? WHERE id = ? RETURNING *');
  const detachAgents = db.prepare('UPDATE agents SET folder_id = NULL, revision = revision + 1 WHERE folder_id = ?');
  const remove = db.prepare('DELETE FROM folders WHERE id = ?');
  const get = db.prepare('SELECT * FROM folders WHERE id = ?');
  const list = db.prepare('SELECT * FROM folders ORDER BY created_at, rowid');
  return {
    insert: (folder) => {
      insert.run({ id: folder.id, name: folder.name, createdAt: folder.createdAt });
    },
    rename: (id, name) => {
      const row = rename.get(name, id);
      return row === undefined ? undefined : FolderRow.parse(row);
    },
    delete: (id) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        detachAgents.run(id);
        const deleted = remove.run(id).changes > 0;
        db.exec('COMMIT');
        return deleted;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    get: (id) => {
      const row = get.get(id);
      return row === undefined ? undefined : FolderRow.parse(row);
    },
    list: () => list.all().map((row) => FolderRow.parse(row)),
  };
}
