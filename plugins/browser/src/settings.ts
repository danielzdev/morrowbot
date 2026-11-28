import { PairingToken } from '@morrowbot/contracts';
import { z, type PluginConfig } from '@morrowbot/plugin-sdk';

/** Where the agent may upload files from. Off unless the person names a folder. */
export type Uploads = { readonly kind: 'off' } | { readonly kind: 'folder'; readonly path: string };

function uploadsOf(folder: string): Uploads {
  return folder === '' ? { kind: 'off' } : { kind: 'folder', path: folder };
}

const Settings = z
  .object({
    pairingToken: PairingToken,
    port: z.number().int().min(1024).max(65535),
    uploadFolder: z.string().trim().refine((value) => value === '' || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), 'The upload folder must be an absolute path'),
  })
  .transform(({ uploadFolder, ...rest }) => ({ ...rest, uploads: uploadsOf(uploadFolder) }));
export type Settings = z.infer<typeof Settings>;

/** The plugin's settings, already filled in by the host; throws with a message the Plugins page shows. */
export function readSettings(config: PluginConfig): Settings {
  const parsed = Settings.safeParse({ pairingToken: typeof config.pairingToken === 'string' ? config.pairingToken.trim() : config.pairingToken, port: config.port, uploadFolder: config.uploadFolder });
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}
