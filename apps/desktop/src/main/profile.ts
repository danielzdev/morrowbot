import path from 'node:path';
import { DEV_DATA_DIR, INSTALLED_DATA_DIR, INSTALLED_HOST_PORT } from '@morrowbot/contracts';

/**
 * Whose data this run opens. Only the installed app, with no `MORROWBOT_DATA_DIR`, opens the real
 * `~/.morrowbot` under Electron's own profile and single-instance lock. Every other run (dev, tests,
 * screenshots) gets its own data folder, its own Electron profile and lock inside it, and a free port,
 * so it can run beside the installed app without touching its chats, settings or port. Only the
 * installed app checks for updates.
 */
export type Profile =
  | { readonly kind: 'installed'; readonly dataDir: string }
  | { readonly kind: 'isolated'; readonly dataDir: string; readonly userDataDir: string }
  | { readonly kind: 'invalid'; readonly problem: string };

export type UsableProfile = Exclude<Profile, { readonly kind: 'invalid' }>;

export interface ProfileInput {
  /** `app.isPackaged`: running from MorrowBot.app rather than `electron .`. */
  readonly packaged: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly homeDir: string;
}

export function profileOf({ packaged, env, homeDir }: ProfileInput): Profile {
  const configured = env.MORROWBOT_DATA_DIR;
  if (configured !== undefined && !path.isAbsolute(configured)) {
    return { kind: 'invalid', problem: `MORROWBOT_DATA_DIR must be an absolute path, not "${configured}".` };
  }
  if (configured === undefined && packaged) return { kind: 'installed', dataDir: path.join(homeDir, INSTALLED_DATA_DIR) };
  const dataDir = configured ?? path.join(homeDir, DEV_DATA_DIR);
  return { kind: 'isolated', dataDir, userDataDir: path.join(dataDir, 'desktop') };
}

/** The host's environment: the profile's data folder and port, and never the release feed token. */
export function hostEnvOf(profile: UsableProfile, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const port = env.MORROWBOT_HOST_PORT ?? (profile.kind === 'installed' ? String(INSTALLED_HOST_PORT) : '0');
  const passed = Object.entries(env).filter(([name]) => name !== 'MORROWBOT_RELEASES_TOKEN');
  return { ...Object.fromEntries(passed), MORROWBOT_DATA_DIR: profile.dataDir, MORROWBOT_HOST_PORT: port };
}
