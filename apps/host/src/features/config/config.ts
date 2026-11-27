import path from 'node:path';
import { DEV_DATA_DIR } from '@morrowbot/contracts';
import { z } from 'zod';

const SAFE_MODE_FLAG = '--safe-mode';

const PortString = z
  .string()
  .regex(/^\d+$/, 'Expected an integer port')
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(65_535));

const AbsolutePath = z.string().refine((value) => path.isAbsolute(value), 'Expected an absolute path');

const HostEnv = z.object({
  MORROWBOT_HOST_PORT: PortString.optional(),
  MORROWBOT_SAFE_MODE: z.enum(['0', '1', 'true', 'false']).optional(),
  MORROWBOT_DATA_DIR: AbsolutePath.optional(),
  MORROWBOT_PLUGINS_DIR: AbsolutePath.optional(),
});

export interface HostConfig {
  readonly hostname: '127.0.0.1';
  /** `MORROWBOT_HOST_PORT`, else a free port. The installed app passes its fixed port itself. */
  readonly port: number;
  /** Start with every plugin turned off. */
  readonly safeMode: boolean;
  /** `MORROWBOT_DATA_DIR`, else `~/.morrowbot-dev`. The installed app passes `~/.morrowbot` itself, so a host run by hand never opens it. */
  readonly dataDir: string;
  readonly pluginsDir: string;
}

export type HostConfigResult =
  | { readonly kind: 'ok'; readonly config: HostConfig }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] };

export interface HostConfigInput {
  readonly env: NodeJS.ProcessEnv;
  /** Command-line arguments after the script path. */
  readonly args: readonly string[];
  readonly homeDir: string;
}

export function parseHostConfig({ env, args, homeDir }: HostConfigInput): HostConfigResult {
  const parsed = HostEnv.safeParse(env);
  const problems = args.filter((arg) => arg !== SAFE_MODE_FLAG).map((arg) => `${arg}: Unknown option`);
  if (!parsed.success) {
    problems.unshift(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  if (!parsed.success || problems.length > 0) return { kind: 'invalid', problems };
  const safeModeEnv = parsed.data.MORROWBOT_SAFE_MODE;
  const dataDir = parsed.data.MORROWBOT_DATA_DIR ?? path.join(homeDir, DEV_DATA_DIR);
  return {
    kind: 'ok',
    config: {
      hostname: '127.0.0.1',
      port: parsed.data.MORROWBOT_HOST_PORT ?? 0,
      safeMode: args.includes(SAFE_MODE_FLAG) || safeModeEnv === '1' || safeModeEnv === 'true',
      dataDir,
      pluginsDir: parsed.data.MORROWBOT_PLUGINS_DIR ?? path.join(dataDir, 'plugins'),
    },
  };
}
