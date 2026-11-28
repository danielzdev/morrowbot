import type { DatabaseSync } from 'node:sqlite';
import { Wait } from '@morrowbot/contracts';
import { z } from 'zod';

const WaitRow = z
  .object({
    wait_id: z.string(),
    agent_id: z.string(),
    routine_id: z.string().nullable(),
    note: z.string(),
    opened_at: z.string(),
    woken_at: z.string().nullable(),
    closed_at: z.string().nullable(),
  })
  .transform((row) => ({
    waitId: row.wait_id,
    agentId: row.agent_id,
    routineId: row.routine_id,
    note: row.note,
    openedAt: row.opened_at,
    wokenAt: row.woken_at,
    closedAt: row.closed_at,
  }))
  .pipe(Wait);

export interface WaitRepository {
  insert(wait: Wait): void;
  get(waitId: string): Wait | undefined;
  /** Open waits, oldest first. */
  listOpen(): Wait[];
  /** Closes an open wait; woken also stamps `wokenAt`. False when it was closed already or does not exist. */
  close(waitId: string, at: string, woken: boolean): boolean;
}

export function waitRepository(db: DatabaseSync): WaitRepository {
  const insert = db.prepare(
    `INSERT INTO waits (wait_id, agent_id, routine_id, note, opened_at, woken_at, closed_at)
     VALUES (:waitId, :agentId, :routineId, :note, :openedAt, NULL, NULL)`,
  );
  const get = db.prepare('SELECT * FROM waits WHERE wait_id = ?');
  const listOpen = db.prepare('SELECT * FROM waits WHERE closed_at IS NULL ORDER BY opened_at, rowid');
  const close = db.prepare(
    'UPDATE waits SET closed_at = :at, woken_at = CASE WHEN :woken = 1 THEN :at ELSE NULL END WHERE wait_id = :waitId AND closed_at IS NULL',
  );
  const parse = (row: unknown): Wait => WaitRow.parse(row);
  return {
    insert: (wait) => {
      insert.run({ waitId: wait.waitId, agentId: wait.agentId, routineId: wait.routineId, note: wait.note, openedAt: wait.openedAt });
    },
    get: (waitId) => {
      const row = get.get(waitId);
      return row === undefined ? undefined : parse(row);
    },
    listOpen: () => listOpen.all().map(parse),
    close: (waitId, at, woken) => close.run({ waitId, at, woken: woken ? 1 : 0 }).changes > 0,
  };
}
