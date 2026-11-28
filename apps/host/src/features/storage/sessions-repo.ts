import type { DatabaseSync } from 'node:sqlite';
import { VendorSettings } from '@morrowbot/contracts';
import { z } from 'zod';
import { SessionState } from './generations-repo.ts';

/** Which vendor session a thread uses: one row per (plugin, account, route, cwd, thread). Never for account ''. */
export interface SessionKey {
  readonly pluginId: string;
  readonly accountKey: string;
  readonly routeKey: string;
  readonly cwd: string;
  readonly threadId: string;
}

const SessionRow = z
  .object({
    id: z.number().int(),
    plugin_id: z.string(),
    account_key: z.string(),
    route_key: z.string(),
    cwd: z.string(),
    thread_id: z.string(),
    ref: z.string(),
    system_hash: z.string(),
    vendor_settings: VendorSettings,
    state: SessionState,
  })
  .transform((row) => ({
    id: row.id,
    key: {
      pluginId: row.plugin_id,
      accountKey: row.account_key,
      routeKey: row.route_key,
      cwd: row.cwd,
      threadId: row.thread_id,
    },
    ref: row.ref,
    systemHash: row.system_hash,
    vendorSettings: row.vendor_settings,
    state: row.state,
  }));
export type SessionRecord = z.output<typeof SessionRow>;

export interface SessionRepository {
  find(key: SessionKey): SessionRecord | undefined;
  get(id: number): SessionRecord | undefined;
  listByThread(threadId: string): SessionRecord[];
  /** Records a vendor session ref as `diverged` (it has history Ori Kami has not seen complete). Returns its row id. */
  bind(key: SessionKey, ref: string, systemHash: string, vendorSettings: VendorSettings): number;
  setState(id: number, state: SessionState): void;
  delete(id: number): void;
  /** Marks every row of the thread under another plugin, account, route or cwd `needs-seed`. */
  markOthersNeedSeed(key: SessionKey): void;
}

export function sessionRepository(db: DatabaseSync): SessionRepository {
  const find = db.prepare(
    `SELECT * FROM provider_sessions WHERE plugin_id = :pluginId AND account_key = :accountKey AND route_key = :routeKey
       AND cwd = :cwd AND thread_id = :threadId`,
  );
  const get = db.prepare('SELECT * FROM provider_sessions WHERE id = ?');
  const listByThread = db.prepare('SELECT * FROM provider_sessions WHERE thread_id = ? ORDER BY id');
  const bind = db.prepare(
    `INSERT INTO provider_sessions (plugin_id, account_key, route_key, cwd, thread_id, ref, system_hash, vendor_settings, state)
     VALUES (:pluginId, :accountKey, :routeKey, :cwd, :threadId, :ref, :systemHash, :vendorSettings, 'diverged')
     ON CONFLICT (plugin_id, account_key, route_key, cwd, thread_id) DO UPDATE SET
       ref = excluded.ref, system_hash = excluded.system_hash, vendor_settings = excluded.vendor_settings, state = 'diverged'
     RETURNING id`,
  );
  const setState = db.prepare('UPDATE provider_sessions SET state = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM provider_sessions WHERE id = ?');
  const markOthers = db.prepare(
    `UPDATE provider_sessions SET state = 'needs-seed' WHERE thread_id = :threadId
       AND NOT (plugin_id = :pluginId AND account_key = :accountKey AND route_key = :routeKey AND cwd = :cwd)`,
  );
  const parse = (row: unknown) => (row === undefined ? undefined : SessionRow.parse(row));
  return {
    find: (key) => parse(find.get({ ...key })),
    get: (id) => parse(get.get(id)),
    listByThread: (threadId) => listByThread.all(threadId).map((row) => SessionRow.parse(row)),
    bind: (key, ref, systemHash, vendorSettings) => {
      if (key.accountKey === '') throw new Error('A session with an unknown account is never saved');
      return z.object({ id: z.number().int() }).parse(bind.get({ ...key, ref, systemHash, vendorSettings })).id;
    },
    setState: (id, state) => {
      setState.run(state, id);
    },
    delete: (id) => {
      remove.run(id);
    },
    markOthersNeedSeed: (key) => {
      markOthers.run({ ...key });
    },
  };
}
