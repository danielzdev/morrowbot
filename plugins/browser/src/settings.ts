import { PairingToken } from '@morrowbot/contracts';
import { z, type PluginConfig } from '@morrowbot/plugin-sdk';

const Settings = z.object({ pairingToken: PairingToken, port: z.number().int().min(1024).max(65535) });
export type Settings = z.infer<typeof Settings>;

/** The plugin's settings, already filled in by the host; throws with a message the Plugins page shows. */
export function readSettings(config: PluginConfig): Settings {
  const parsed = Settings.safeParse({ pairingToken: typeof config.pairingToken === 'string' ? config.pairingToken.trim() : config.pairingToken, port: config.port });
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}
