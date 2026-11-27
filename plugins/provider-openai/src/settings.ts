import { z, type PluginConfig } from '@morrowbot/plugin-sdk';

const Config = z.object({
  cliPath: z.string().trim().min(1, 'Set "Codex CLI path" to "codex" or the full path of the CLI'),
});

/** The plugin's settings from `manifest.json`. */
export type Settings = z.infer<typeof Config>;

export function parseSettings(config: PluginConfig): Settings {
  const parsed = Config.safeParse(config);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}
