import { z, type PluginContext } from '@morrowbot/plugin-sdk';

const Config = z.object({
  model: z.string().min(1),
  cliPath: z.string().trim().min(1, 'Set "Claude Code CLI path" to "claude" or the full path of the CLI'),
});

/** The plugin's settings from `manifest.json`, plus the folder the CLI runs in. */
export interface Settings {
  readonly model: string;
  readonly cliPath: string;
  /** The plugin's own empty data folder, so the CLI's file tools see none of the user's files. */
  readonly cwd: string;
}

export function parseSettings({ config, dataDir }: PluginContext): Settings {
  const parsed = Config.safeParse(config);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  return { ...parsed.data, cwd: dataDir };
}
