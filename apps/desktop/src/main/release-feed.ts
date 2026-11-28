import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** The private release feed until Ori Kami is public; `ORIKAMI_RELEASES_REPO` points a build, or a run, at another. */
export const DEFAULT_RELEASES_REPO = 'danielzdev/ori-kami-releases';
/** The login Keychain item (`security add-generic-password -s … -a releases -w <token>`) holding the feed's read token. */
export const KEYCHAIN_SERVICE = 'com.legendarykoi.orikami.releases';

export const RepoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Expected owner/repo');
/** What `scripts/build-app.ts` writes into the packaged app's package.json: the repo that build publishes to. */
export const BuiltFeed = z.object({ orikami: z.object({ releasesRepo: RepoName }) });
const Token = z.string().trim().min(1);

export type ReleaseFeed =
  | { readonly kind: 'github'; readonly owner: string; readonly repo: string; readonly token: string | null }
  | { readonly kind: 'invalid'; readonly problem: string };

export interface FeedSources {
  readonly env: NodeJS.ProcessEnv;
  /** The repo this build was published to, or null when the app's package.json names none. */
  readonly builtRepo: string | null;
  readonly keychainToken: string | null;
}

/** The GitHub release feed: `ORIKAMI_RELEASES_REPO`, else the build's repo, read with `ORIKAMI_RELEASES_TOKEN` or the Keychain token. */
export function feedOf({ env, builtRepo, keychainToken }: FeedSources): ReleaseFeed {
  const name = RepoName.safeParse(env.ORIKAMI_RELEASES_REPO ?? builtRepo ?? DEFAULT_RELEASES_REPO);
  if (!name.success) return { kind: 'invalid', problem: `ORIKAMI_RELEASES_REPO: ${name.error.issues.map(({ message }) => message).join(', ')}` };
  const [owner = '', repo = ''] = name.data.split('/');
  const token = Token.safeParse(env.ORIKAMI_RELEASES_TOKEN ?? keychainToken);
  return { kind: 'github', owner, repo, token: token.success ? token.data : null };
}

/** The feed token from the login Keychain, or null when there is none. */
export function readKeychainToken(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeout: 10_000 }, (error, stdout) => {
      const token = Token.safeParse(stdout);
      resolve(error === null && token.success ? token.data : null);
    });
  });
}

/** The repo the packaged app at `appPath` was published to. */
export async function readBuiltRepo(appPath: string): Promise<string | null> {
  try {
    const built = BuiltFeed.safeParse(JSON.parse(await readFile(path.join(appPath, 'package.json'), 'utf8')));
    return built.success ? built.data.orikami.releasesRepo : null;
  } catch {
    return null;
  }
}
