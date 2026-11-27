import type { DatabaseSync } from 'node:sqlite';
import { Memory } from '@morrowbot/contracts';
import { z } from 'zod';

const MemoryRow = z
  .object({ id: z.string(), agent_id: z.string(), inclusion: z.string(), text: z.string(), created_at: z.string(), updated_at: z.string() })
  .transform((row) => ({
    id: row.id,
    agentId: row.agent_id,
    inclusion: row.inclusion,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .pipe(Memory);

export interface MemoryRepository {
  insert(memory: Memory): void;
  /** Saves the memory's text, inclusion and update time. */
  update(memory: Memory): void;
  delete(agentId: string, id: string): boolean;
  get(agentId: string, id: string): Memory | undefined;
  /** The agent's memories, oldest first. */
  list(agentId: string): Memory[];
  essential(agentId: string): Memory[];
  /** The agent's memories holding every word of `query` (a word may be the start of a longer one), best match first. */
  search(agentId: string, query: string): Memory[];
}

/** `query` as an FTS5 match: each word quoted (so it is never syntax) and matched as a prefix. Null when it has no words. */
export function matchExpression(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words.length === 0 ? null : words.map((word) => `"${word}"*`).join(' ');
}

export function memoryRepository(db: DatabaseSync): MemoryRepository {
  const insert = db.prepare(
    `INSERT INTO memories (id, agent_id, inclusion, text, created_at, updated_at)
     VALUES (:id, :agentId, :inclusion, :text, :createdAt, :updatedAt)`,
  );
  const update = db.prepare('UPDATE memories SET inclusion = :inclusion, text = :text, updated_at = :updatedAt WHERE id = :id AND agent_id = :agentId');
  const remove = db.prepare('DELETE FROM memories WHERE id = ? AND agent_id = ?');
  const get = db.prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?');
  const list = db.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at, seq');
  const essential = db.prepare(`SELECT * FROM memories WHERE agent_id = ? AND inclusion = 'essential' ORDER BY created_at, seq`);
  const search = db.prepare(
    `SELECT m.* FROM memories_fts f JOIN memories m ON m.seq = f.rowid
     WHERE memories_fts MATCH ? AND m.agent_id = ? ORDER BY bm25(memories_fts), m.seq`,
  );
  const parse = (row: unknown): Memory => MemoryRow.parse(row);
  return {
    insert: (memory) => {
      insert.run({ ...memory });
    },
    update: (memory) => {
      update.run({ id: memory.id, agentId: memory.agentId, inclusion: memory.inclusion, text: memory.text, updatedAt: memory.updatedAt });
    },
    delete: (agentId, id) => remove.run(id, agentId).changes > 0,
    get: (agentId, id) => {
      const row = get.get(id, agentId);
      return row === undefined ? undefined : parse(row);
    },
    list: (agentId) => list.all(agentId).map(parse),
    essential: (agentId) => essential.all(agentId).map(parse),
    search: (agentId, query) => {
      const match = matchExpression(query);
      return match === null ? list.all(agentId).map(parse) : search.all(match, agentId).map(parse);
    },
  };
}
