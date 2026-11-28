import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Keychain } from './keychain.ts';
import type { ResetContext } from './reset-paths.ts';

/** A throwaway home folder in the temp folder, with real paths (macOS links `/var` to `/private/var`). */
export interface FakeHome {
  readonly home: string;
  file(relative: string, text?: string): Promise<string>;
  link(relative: string, target: string): Promise<string>;
  /** Every file and link under home, relative and sorted; links shown as `name (link)` and never followed. */
  tree(): Promise<readonly string[]>;
  /** Replaces the home path with `~` in recorded data. */
  short(value: unknown): unknown;
  context(kind: 'installed' | 'isolated', dataDir: string, workspaces?: readonly string[] | null): ResetContext;
  remove(): Promise<void>;
}

/** Every file and link under `dir`, never descending into a link. */
async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) found.push(`${full} (link)`);
    else if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

export async function fakeHome(): Promise<FakeHome> {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-reset-')));
  const at = (relative: string): string => path.join(home, relative);
  return {
    home,
    file: async (relative, text = 'x') => {
      await mkdir(path.dirname(at(relative)), { recursive: true });
      await writeFile(at(relative), text);
      return at(relative);
    },
    link: async (relative, target) => {
      await mkdir(path.dirname(at(relative)), { recursive: true });
      await symlink(target, at(relative));
      return at(relative);
    },
    tree: async () => (await walk(home)).map((file) => path.relative(home, file)).sort(),
    short: (value) => {
      const parsed: unknown = JSON.parse(JSON.stringify(value).replaceAll(home, '~'));
      return parsed;
    },
    context: (kind, dataDir, workspaces = []) => ({ platform: 'darwin', homeDir: home, profile: { kind, dataDir: at(dataDir) }, workspaces }),
    remove: () => rm(home, { recursive: true, force: true }),
  };
}

/** The Keychain as a set of service names, for checking which items a run removes. */
export function fakeKeychain(services: readonly string[]): Keychain & { readonly items: Set<string> } {
  const items = new Set(services);
  return {
    items,
    has: (service) => Promise.resolve(items.has(service)),
    remove: (service) => {
      items.delete(service);
      return Promise.resolve();
    },
  };
}

export const INFO_PLIST = (bundleId: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n    <key>CFBundleIdentifier</key>\n    <string>${bundleId}</string>\n  </dict>\n</plist>\n`;
