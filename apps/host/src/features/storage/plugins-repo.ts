import type { DatabaseSync } from 'node:sqlite';
import { PluginConfig } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const RecordRow = z.object({
  enabled: z.union([z.literal(0), z.literal(1), z.null()]),
  config: z.union([jsonColumn(PluginConfig), z.null()]),
});

export interface PluginSettingsRecord {
  readonly enabled: boolean;
  readonly config: PluginConfig;
}

/** The plugin host's store: on/off switches in `plugin_states`, saved settings in `plugin_configs`. */
export interface PluginSettingsRepository {
  read(pluginId: string): Promise<PluginSettingsRecord | undefined>;
  write(pluginId: string, record: PluginSettingsRecord): Promise<void>;
}

export function pluginSettingsRepository(db: DatabaseSync, now: () => string): PluginSettingsRepository {
  const read = db.prepare(
    `SELECT s.enabled AS enabled, c.config AS config
     FROM (SELECT ? AS plugin_id) AS p
     LEFT JOIN plugin_states AS s ON s.plugin_id = p.plugin_id
     LEFT JOIN plugin_configs AS c ON c.plugin_id = p.plugin_id`,
  );
  const writeState = db.prepare(
    `INSERT INTO plugin_states (plugin_id, enabled, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (plugin_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  );
  const writeConfig = db.prepare(
    `INSERT INTO plugin_configs (plugin_id, config, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (plugin_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
  );
  return {
    read: (pluginId) => {
      const row = RecordRow.parse(read.get(pluginId));
      if (row.enabled === null && row.config === null) return Promise.resolve(undefined);
      return Promise.resolve({ enabled: row.enabled !== 0, config: row.config ?? {} });
    },
    write: (pluginId, record) => {
      const at = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        writeState.run(pluginId, record.enabled ? 1 : 0, at);
        writeConfig.run(pluginId, JSON.stringify(record.config), at);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
  };
}
