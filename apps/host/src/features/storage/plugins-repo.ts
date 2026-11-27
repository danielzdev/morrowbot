import type { DatabaseSync } from 'node:sqlite';
import { PluginConfig } from '@morrowbot/contracts';
import { z } from 'zod';
import { jsonColumn } from './columns.ts';

const StateRow = z.object({ plugin_id: z.string(), enabled: z.union([z.literal(0), z.literal(1)]) });
const ConfigRow = z.object({ plugin_id: z.string(), config: jsonColumn(PluginConfig) });

/** Stored plugin on/off switches and settings. Plugins without a row have never been changed. */
export interface PluginSettingsRepository {
  enabledStates(): ReadonlyMap<string, boolean>;
  configs(): ReadonlyMap<string, PluginConfig>;
  setEnabled(pluginId: string, enabled: boolean, at: string): void;
  setConfig(pluginId: string, config: PluginConfig, at: string): void;
}

export function pluginSettingsRepository(db: DatabaseSync): PluginSettingsRepository {
  const states = db.prepare('SELECT plugin_id, enabled FROM plugin_states');
  const configs = db.prepare('SELECT plugin_id, config FROM plugin_configs');
  const setEnabled = db.prepare(
    `INSERT INTO plugin_states (plugin_id, enabled, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (plugin_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  );
  const setConfig = db.prepare(
    `INSERT INTO plugin_configs (plugin_id, config, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (plugin_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
  );
  return {
    enabledStates: () =>
      new Map(states.all().map((row) => StateRow.parse(row)).map((row) => [row.plugin_id, row.enabled === 1])),
    configs: () => new Map(configs.all().map((row) => ConfigRow.parse(row)).map((row) => [row.plugin_id, row.config])),
    setEnabled: (pluginId, enabled, at) => {
      setEnabled.run(pluginId, enabled ? 1 : 0, at);
    },
    setConfig: (pluginId, config, at) => {
      setConfig.run(pluginId, JSON.stringify(config), at);
    },
  };
}
