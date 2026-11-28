import { isIP } from 'node:net';
import path from 'node:path';
import { DEV_DATA_DIR } from '@morrowbot/contracts';
import { z } from 'zod';

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
  ORIBOT_HOST_PORT: PortString.optional(),
  ORIBOT_HOST_BIND: BindAddress.optional(),
  ORIBOT_SAFE_MODE: z.enum(['0', '1', 'true', 'false']).optional(),
  ORIBOT_DATA_DIR: AbsolutePath.optional(),
  ORIBOT_PLUGINS_DIR: AbsolutePath.optional(),
  ORIBOT_BUILTIN_PLUGINS_DIR: AbsolutePath.optional(),
  ORIBOT_T3_WATCH_DIR: AbsolutePath.optional(),
  ORIBOT_T3_BIN: AbsolutePath.optional(),
  ORIBOT_T3_ROUTINE_ID: z.string().trim().min(1).optional(),
  ORIBOT_T3_PROJECTS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((project) => project.trim())
        .filter((project) => project !== ''),
    )
    .optional(),
});

/** The T3 Code watcher: where agents register threads, which `t3` to run, and which projects discovery scans. */
export interface T3WatchConfig {
  /** `ORIBOT_T3_WATCH_DIR`, else `t3-watch` in the data folder. Point it at a folder sandboxed agents can write. */
  readonly dir: string;
  /** `ORIBOT_T3_BIN`, else `~/.t3/bin/t3`. */
  readonly bin: string;
  /** `ORIBOT_T3_PROJECTS` (comma-separated project ids or paths); empty turns discovery off. */
  readonly projects: readonly string[];
  /** `ORIBOT_T3_ROUTINE_ID`: the orchestrator's background routine that batches go to; unset keeps delivery off. */
  readonly routineId: string | null;
}

export interface HostConfig {
  /** `127.0.0.1` unless the user opts in to a LAN or Tailscale address with `ORIBOT_HOST_BIND`. */
  readonly hostname: string;
  /** `ORIBOT_HOST_PORT`, else a free port. The installed app passes its fixed port itself. */
  readonly port: number;
  /** Start with every plugin turned off. */
  readonly safeMode: boolean;
  /** `ORIBOT_DATA_DIR`, else `~/.oribot-dev`. The installed app passes `~/.oribot` itself, so a host run by hand never opens it. */
  readonly dataDir: string;
  readonly pluginsDir: string;
  /** The plugins folder that ships inside the app; null when none is given. */
  readonly builtinPluginsDir: string | null;
  readonly t3Watch: T3WatchConfig;
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
  const safeModeEnv = parsed.data.ORIBOT_SAFE_MODE;
  const dataDir = parsed.data.ORIBOT_DATA_DIR ?? path.join(homeDir, DEV_DATA_DIR);
  return {
    kind: 'ok',
    config: {
      hostname: parsed.data.ORIBOT_HOST_BIND ?? '127.0.0.1',
      port: parsed.data.ORIBOT_HOST_PORT ?? 0,
      safeMode: args.includes(SAFE_MODE_FLAG) || safeModeEnv === '1' || safeModeEnv === 'true',
      dataDir,
      pluginsDir: parsed.data.ORIBOT_PLUGINS_DIR ?? path.join(dataDir, 'plugins'),
      builtinPluginsDir: parsed.data.ORIBOT_BUILTIN_PLUGINS_DIR ?? null,
      t3Watch: {
        dir: parsed.data.ORIBOT_T3_WATCH_DIR ?? path.join(dataDir, 't3-watch'),
        bin: parsed.data.ORIBOT_T3_BIN ?? path.join(homeDir, '.t3', 'bin', 't3'),
        projects: parsed.data.ORIBOT_T3_PROJECTS ?? [],
        routineId: parsed.data.ORIBOT_T3_ROUTINE_ID ?? null,
      },
    },
  };
}
