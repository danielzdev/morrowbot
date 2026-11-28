import path from 'node:path';
import { INSTALLED_DATA_DIR } from '@morrowbot/contracts';
import { APP_ID, PRODUCT_NAME } from '../app-identity.ts';

/** What one reset or uninstall run is about: which profile, under whose home, and which folders agents use. */
export interface ResetContext {
  readonly platform: NodeJS.Platform;
  /** The home folder with every symbolic link resolved. */
  readonly homeDir: string;
  readonly profile: { readonly kind: 'installed' | 'isolated'; readonly dataDir: string };
  /** Every agent's workspace folder as the host reported it, or null when the host could not say. */
  readonly workspaces: readonly string[] | null;
}

/** The entries MorrowBot itself writes in its data folder. Anything else there, `workspaces/` above all, stays. */
export const DATA_ENTRIES: readonly string[] = [
  'morrowbot.sqlite',
  'morrowbot.sqlite-wal',
  'morrowbot.sqlite-shm',
  'morrowbot.sqlite-journal',
  'host.lock.db',
  'host.lock.db-journal',
  'host.lock.db-wal',
  'host.lock.db-shm',
  'launch.json',
  'attachments',
  'instructions-drafts',
  'plugin-data',
  'plugins',
  'skills',
  't3-watch',
];

/** An isolated run's own Electron profile, inside its data folder (see `profile.ts`). */
const ISOLATED_ELECTRON_PROFILE = 'desktop';

/** The folder in the data folder that holds dedicated agent workspaces; never a target. */
export const WORKSPACES_ENTRY = 'workspaces';

/** The installed app's files outside its data folder, under the home folder. */
export const INSTALLED_LIBRARY_PATHS: readonly string[] = [
  `Library/Application Support/${PRODUCT_NAME}`,
  `Library/Caches/${APP_ID}`,
  `Library/Caches/${APP_ID}.ShipIt`,
  'Library/Caches/morrowbot-updater',
  `Library/HTTPStorages/${APP_ID}`,
  `Library/Logs/${PRODUCT_NAME}`,
  `Library/Preferences/${APP_ID}.plist`,
  `Library/Saved Application State/${APP_ID}.savedState`,
];

/** The login Keychain items the installed app owns: the release feed token, and Electron's own storage key. */
export const KEYCHAIN_SERVICES: readonly string[] = [`${APP_ID}.releases`, `${PRODUCT_NAME} Safe Storage`];

/** True when `inner` is `outer` or inside it. Both must be normalised absolute paths. */
export function isWithin(inner: string, outer: string): boolean {
  if (inner === outer) return true;
  const rest = path.relative(outer, inner);
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${path.sep}`) && !path.isAbsolute(rest);
}

const strictlyInside = (inner: string, outer: string): boolean => inner !== outer && isWithin(inner, outer);

/** Why the data folder may not be cleaned at all in this profile, or null when it may. */
export function dataDirRefusal(context: ResetContext): string | null {
  const { homeDir, profile } = context;
  const installedDir = path.join(homeDir, INSTALLED_DATA_DIR);
  if (!path.isAbsolute(profile.dataDir) || path.normalize(profile.dataDir) !== profile.dataDir) return 'The data folder is not a plain absolute path.';
  switch (profile.kind) {
    case 'installed':
      return profile.dataDir === installedDir ? null : `The installed app keeps its data only in ~/${INSTALLED_DATA_DIR}.`;
    case 'isolated':
      if (isWithin(profile.dataDir, installedDir) || isWithin(installedDir, profile.dataDir)) return `A development run never resets the installed app's ~/${INSTALLED_DATA_DIR}.`;
      return strictlyInside(profile.dataDir, homeDir) ? null : 'This run keeps its data outside your home folder, so it cannot be reset from here.';
  }
}

/** A file or folder this run would remove for good, before anything on disk is checked. */
export interface DeleteCandidate {
  readonly path: string;
  /** The folder it must stay strictly inside. */
  readonly root: string;
}

/** Every path a reset removes, when it exists and passes `refusalOf`: MorrowBot's own entries in its data folder, then (installed only) its Library files. */
export function deleteCandidatesOf(context: ResetContext): readonly DeleteCandidate[] {
  const { homeDir, profile } = context;
  const own = profile.kind === 'isolated' ? [...DATA_ENTRIES, ISOLATED_ELECTRON_PROFILE] : DATA_ENTRIES;
  const data = own.map((name) => ({ path: path.join(profile.dataDir, name), root: profile.dataDir }));
  switch (profile.kind) {
    case 'installed':
      return [...data, ...INSTALLED_LIBRARY_PATHS.map((relative) => ({ path: path.join(homeDir, relative), root: homeDir }))];
    case 'isolated':
      return data;
  }
}

/** What the disk says about a path, read with `lstat` and `realpath`. */
export type PathFacts =
  | { readonly kind: 'missing' }
  | { readonly kind: 'symlink' }
  | { readonly kind: 'present'; readonly realPath: string };

/** Every agent workspace: the data folder's `workspaces/` and each folder the host reported. No target may hold one or sit inside one. */
export function workspacesOf(context: ResetContext): readonly string[] {
  return [path.join(context.profile.dataDir, WORKSPACES_ENTRY), ...(context.workspaces ?? [])];
}

/**
 * Why a target may not be touched, or null when it may. A target must be a plain absolute path strictly
 * inside its root and inside the home folder, must neither hold nor sit inside an agent workspace, and
 * must not be a symbolic link nor be reached through one.
 */
export function refusalOf(target: string, root: string, homeDir: string, facts: Exclude<PathFacts, { readonly kind: 'missing' }>, workspaces: readonly string[]): string | null {
  if (!path.isAbsolute(target) || path.normalize(target) !== target) return 'Not a plain absolute path.';
  if (!strictlyInside(target, root) || !strictlyInside(target, homeDir)) return "Outside MorrowBot's own folders.";
  if (workspaces.some((workspace) => isWithin(target, workspace) || isWithin(workspace, target))) return 'An agent workspace, or holds one. Workspaces are never touched.';
  switch (facts.kind) {
    case 'symlink':
      return 'A symbolic link. MorrowBot does not follow it.';
    case 'present':
      return facts.realPath === target ? null : 'Reached through a symbolic link. MorrowBot does not follow it.';
  }
}

/** Where MorrowBot.app may be installed: the system or the user's own Applications folder. */
export const appFoldersOf = (homeDir: string): readonly string[] => ['/Applications', path.join(homeDir, 'Applications')];

/** The app bundle that holds `execPath` (`…/MorrowBot.app/Contents/MacOS/MorrowBot`), or why it cannot be moved to the Trash. */
export function bundleOf(execPath: string, homeDir: string): { readonly kind: 'bundle'; readonly path: string } | { readonly kind: 'refused'; readonly reason: string } {
  const macos = path.dirname(execPath);
  const contents = path.dirname(macos);
  const bundle = path.dirname(contents);
  if (!path.isAbsolute(execPath) || path.normalize(execPath) !== execPath || path.basename(macos) !== 'MacOS' || path.basename(contents) !== 'Contents') {
    return { kind: 'refused', reason: 'MorrowBot is not running from an app bundle.' };
  }
  if (path.basename(bundle) !== `${PRODUCT_NAME}.app` || !appFoldersOf(homeDir).includes(path.dirname(bundle))) {
    return { kind: 'refused', reason: `Uninstalling works only for ${PRODUCT_NAME}.app in Applications. Move it there, or drag it to the Trash yourself.` };
  }
  return { kind: 'bundle', path: bundle };
}

/** The bundle id an app's `Contents/Info.plist` (XML, as electron-builder writes it) declares, or null. */
export function bundleIdIn(infoPlist: string): string | null {
  return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(infoPlist)?.[1] ?? null;
}
