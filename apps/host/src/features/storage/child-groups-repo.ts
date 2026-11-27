import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const ChildGroupKind = z.enum(['turn', 'daemon', 'probe']);
export type ChildGroupKind = z.infer<typeof ChildGroupKind>;

/** A process group a plugin started, recorded before its command runs and deleted once it is confirmed gone. */
export interface ChildGroupRecord {
  readonly pgid: number;
  readonly regId: string;
  readonly pluginId: string;
  readonly kind: ChildGroupKind;
  readonly bootId: string | null;
  readonly leaderStart: string;
  readonly startedAt: string;
  readonly generationIds: readonly string[];
}

const GroupRow = z.object({
  pgid: z.number().int(),
  reg_id: z.string(),
  plugin_id: z.string(),
  kind: ChildGroupKind,
  boot_id: z.string().nullable(),
  leader_start: z.string(),
  started_at: z.string(),
  generation_ids: z.string().nullable(),
});

export interface ChildGroupRepository {
  insert(record: ChildGroupRecord): void;
  delete(pgid: number): void;
  get(pgid: number): ChildGroupRecord | undefined;
  list(): ChildGroupRecord[];
  /** Threads that a recorded turn group still holds. */
  heldThreads(): Set<string>;
}

export function childGroupRepository(db: DatabaseSync): ChildGroupRepository {
  const insert = db.prepare(
    `INSERT INTO child_groups (pgid, reg_id, plugin_id, kind, boot_id, leader_start, started_at)
     VALUES (:pgid, :regId, :pluginId, :kind, :bootId, :leaderStart, :startedAt)`,
  );
  const link = db.prepare('INSERT INTO child_group_generations (pgid, generation_id) VALUES (?, ?)');
  const remove = db.prepare('DELETE FROM child_groups WHERE pgid = ?');
  const select = `SELECT g.*, (SELECT group_concat(generation_id, char(10)) FROM child_group_generations l WHERE l.pgid = g.pgid)
    AS generation_ids FROM child_groups g`;
  const get = db.prepare(`${select} WHERE g.pgid = ?`);
  const list = db.prepare(`${select} ORDER BY g.started_at, g.pgid`);
  const held = db.prepare(
    `SELECT DISTINCT gen.thread_id AS thread_id FROM child_group_generations l
       JOIN child_groups g ON g.pgid = l.pgid AND g.kind = 'turn'
       JOIN generations gen ON gen.id = l.generation_id`,
  );
  const parse = (row: unknown): ChildGroupRecord => {
    const parsed = GroupRow.parse(row);
    return {
      pgid: parsed.pgid,
      regId: parsed.reg_id,
      pluginId: parsed.plugin_id,
      kind: parsed.kind,
      bootId: parsed.boot_id,
      leaderStart: parsed.leader_start,
      startedAt: parsed.started_at,
      generationIds: parsed.generation_ids === null ? [] : parsed.generation_ids.split('\n').sort(),
    };
  };
  return {
    insert: ({ generationIds, ...record }) => {
      insert.run({ ...record });
      for (const id of generationIds) link.run(record.pgid, id);
    },
    delete: (pgid) => {
      remove.run(pgid);
    },
    get: (pgid) => {
      const row = get.get(pgid);
      return row === undefined ? undefined : parse(row);
    },
    list: () => list.all().map(parse),
    heldThreads: () => new Set(held.all().map((row) => z.object({ thread_id: z.string() }).parse(row).thread_id)),
  };
}
