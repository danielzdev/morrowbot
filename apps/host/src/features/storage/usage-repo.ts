import type { DatabaseSync } from 'node:sqlite';
import { UsageWindow } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

export interface UsageSnapshot {
  readonly observedAt: string;
  readonly windows: readonly UsageWindow[];
}

/** The last plan-usage windows seen per (plugin, account). Never written for account ''. */
export interface UsageSnapshotRepository {
  /** Merges windows by id; a window is replaced only by a newer observation of that window. */
  merge(pluginId: string, accountKey: string, observedAt: string, windows: readonly UsageWindow[]): void;
  read(pluginId: string, accountKey: string): UsageSnapshot | undefined;
}

const SnapshotRow = z.object({ window: jsonColumn(UsageWindow), observed_at: z.string() });

export function usageSnapshotRepository(db: DatabaseSync): UsageSnapshotRepository {
  const upsert = db.prepare(
    `INSERT INTO usage_snapshots (plugin_id, account_key, window_id, window, observed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (plugin_id, account_key, window_id) DO UPDATE SET window = excluded.window, observed_at = excluded.observed_at
     WHERE excluded.observed_at > usage_snapshots.observed_at`,
  );
  const read = db.prepare('SELECT window, observed_at FROM usage_snapshots WHERE plugin_id = ? AND account_key = ? ORDER BY window_id');
  return {
    merge: (pluginId, accountKey, observedAt, windows) => {
      if (accountKey === '') return;
      for (const window of windows) upsert.run(pluginId, accountKey, window.id, JSON.stringify(window), observedAt);
    },
    read: (pluginId, accountKey) => {
      const rows = read.all(pluginId, accountKey).map((row) => SnapshotRow.parse(row));
      if (rows.length === 0) return undefined;
      const observedAt = rows.map((row) => row.observed_at).sort()[0] ?? '';
      return { observedAt, windows: rows.map((row) => row.window) };
    },
  };
}
