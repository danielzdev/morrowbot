import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';

const DEFAULT_PORT = 47_800;
const SAFE_MODE_FLAG = '--safe-mode';

const PortString = z
  .string()
  .regex(/^\d+$/, 'Expected an integer port')
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(65_535));

/** One spelling per address (IPv6 compressed and lowercased), so loopback and wildcard checks see a single form. */
const BindAddress = z
  .string()
  .refine((value) => isIP(value) !== 0 && !value.includes('%'), 'Expected an IPv4 or IPv6 address, such as 100.64.0.1 or 0.0.0.0')
  .transform((value) => (isIP(value) === 6 ? new URL(`http://[${value}]`).hostname.slice(1, -1) : value))
  .refine((value) => !value.startsWith('::ffff:'), 'Use the IPv4 form of an IPv4-mapped address');

const AbsolutePath = z.string().refine((value) => path.isAbsolute(value), 'Expected an absolute path');

const HostEnv = z.object({
  MORROWBOT_HOST_PORT: PortString.optional(),
  MORROWBOT_HOST_BIND: BindAddress.optional(),
  MORROWBOT_SAFE_MODE: z.enum(['0', '1', 'true', 'false']).optional(),
  MORROWBOT_DATA_DIR: AbsolutePath.optional(),
  MORROWBOT_PLUGINS_DIR: AbsolutePath.optional(),
  MORROWBOT_BUILTIN_PLUGINS_DIR: AbsolutePath.optional(),
});

export interface HostConfig {
  /** `127.0.0.1` unless the user opts in to a LAN or Tailscale address with `MORROWBOT_HOST_BIND`. */
  readonly hostname: string;
  readonly port: number;
  /** Start with every plugin turned off. */
  readonly safeMode: boolean;
  readonly dataDir: string;
  readonly pluginsDir: string;
  /** The plugins folder that ships inside the app; null when none is given. */
  readonly builtinPluginsDir: string | null;
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
  const dataDir = parsed.data.MORROWBOT_DATA_DIR ?? path.join(homeDir, '.morrowbot');
  return {
    kind: 'ok',
    config: {
      hostname: parsed.data.MORROWBOT_HOST_BIND ?? '127.0.0.1',
      port: parsed.data.MORROWBOT_HOST_PORT ?? DEFAULT_PORT,
      safeMode: args.includes(SAFE_MODE_FLAG) || safeModeEnv === '1' || safeModeEnv === 'true',
      dataDir,
      pluginsDir: parsed.data.MORROWBOT_PLUGINS_DIR ?? path.join(dataDir, 'plugins'),
      builtinPluginsDir: parsed.data.MORROWBOT_BUILTIN_PLUGINS_DIR ?? null,
    },
  };
}
