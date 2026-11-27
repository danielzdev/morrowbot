import { z, type PluginConfig } from '@morrowbot/plugin-sdk';

const Settings = z.object({ model: z.string().min(1), cliPath: z.string().min(1) });

/** The plugin's settings from `manifest.json`, after the host checked them and filled in defaults. */
export type Settings = z.infer<typeof Settings>;

export function parseSettings(config: PluginConfig): Settings {
  return Settings.parse(config);
}
