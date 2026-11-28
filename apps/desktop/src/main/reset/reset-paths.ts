import path from 'node:path';
import { DEV_DATA_DIR, INSTALLED_DATA_DIR } from '@morrowbot/contracts';
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

/** The entries Ori Bot itself writes in its data folder. Anything else there, `workspaces/` above all, stays. */
/** The vault's sealed secrets, which `VAULT_KEY` unlocks. */
export const VAULT_SECRETS = 'vault-secrets.json';

export const DATA_ENTRIES: readonly string[] = [
  'oribot.sqlite',
  'oribot.sqlite-wal',
  'oribot.sqlite-shm',
  'oribot.sqlite-journal',
  'host.lock.db',
  'host.lock.db-journal',
  'host.lock.db-wal',
  'host.lock.db-shm',
  'launch.json',
  'launch.json.tmp',
  'server.json',
  'server.json.tmp',
  'attachments',
  'instructions-drafts',
  'plugin-data',
  'plugins',
  'sign-in',
  'skills',
  't3-watch',
  'vault.json',
  VAULT_SECRETS,
  'vault.key',
  'vault.key.dpapi',
];

/** An isolated run's own Electron profile, inside its data folder (see `profile.ts`). */
const ISOLATED_ELECTRON_PROFILE = 'desktop';

/** The folder in the data folder that holds dedicated agent workspaces; never a target. */
export const WORKSPACES_ENTRY = 'workspaces';

/** Electron's own profile for the installed app; `Ori Bot Safe Storage` encrypts what is in it. */
export const ELECTRON_PROFILE = `Library/Application Support/${PRODUCT_NAME}`;

/** The installed app's files outside its data folder, under the home folder. */
export const INSTALLED_LIBRARY_PATHS: readonly string[] = [
  ELECTRON_PROFILE,
  `Library/Caches/${APP_ID}`,
  `Library/Caches/${APP_ID}.ShipIt`,
  'Library/Caches/oribot-updater',
  `Library/HTTPStorages/${APP_ID}`,
  `Library/Logs/${PRODUCT_NAME}`,
  `Library/Preferences/${APP_ID}.plist`,
  `Library/Saved Application State/${APP_ID}.savedState`,
];

/** One login Keychain item, named exactly by service and account. */
export interface KeychainItem {
  readonly service: string;
  readonly account: string;
}

/** The release feed token RELEASING.md has testers add. Reset keeps it so updates keep working; only Full uninstall removes it. */
export const RELEASE_TOKEN: KeychainItem = { service: `${APP_ID}.releases`, account: 'releases' };

/** The vault's master key, which every data folder on this Mac shares; removed only with the installed app's `VAULT_SECRETS`. */
export const VAULT_KEY: KeychainItem = { service: `${APP_ID}.vault`, account: 'master-key' };

/** Electron's key for the files in `ELECTRON_PROFILE` (Electron names the account after the app); removed only once they are gone. */
export const SAFE_STORAGE: KeychainItem = { service: `${PRODUCT_NAME} Safe Storage`, account: PRODUCT_NAME };

/**
 * A path as APFS compares it by default: normalised, no trailing separator, one Unicode form, any case (folded
 * through upper case too, so `ſ` is `s`). Every protection check compares these, so `~/.OriBot` is
 * `~/.oribot` and a workspace spelt in another case is still that workspace. Folding more paths together
 * only ever refuses more: every target is built inside its root, and must also equal its own `realpath`.
 */
export function comparable(target: string): string {
  const normal = path.normalize(target);
  const trimmed = normal.length > 1 && normal.endsWith(path.sep) ? normal.slice(0, -1) : normal;
  return trimmed.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

/** True when `inner` is `outer` or inside it, compared as APFS would (see `comparable`). */
export function isWithin(inner: string, outer: string): boolean {
  const [a, b] = [comparable(inner), comparable(outer)];
  if (a === b) return true;
  const rest = path.relative(b, a);
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${path.sep}`) && !path.isAbsolute(rest);
}

const strictlyInside = (inner: string, outer: string): boolean => comparable(inner) !== comparable(outer) && isWithin(inner, outer);

/** Why the data folder may not be cleaned at all in this profile, or null when it may. */
export function dataDirRefusal(context: ResetContext): string | null {
  const { homeDir, profile } = context;
  const installedDir = path.join(homeDir, INSTALLED_DATA_DIR);
  const devDir = path.join(homeDir, DEV_DATA_DIR);
  if (!path.isAbsolute(profile.dataDir) || path.normalize(profile.dataDir) !== profile.dataDir) return 'The data folder is not a plain absolute path.';
  switch (profile.kind) {
    case 'installed':
      return profile.dataDir === installedDir ? null : `The installed app keeps its data only in ~/${INSTALLED_DATA_DIR}.`;
    case 'isolated':
      if (isWithin(profile.dataDir, installedDir) || isWithin(installedDir, profile.dataDir)) return `A development run never resets the installed app's ~/${INSTALLED_DATA_DIR}.`;
      return profile.dataDir === devDir ? null : `A development run resets only ~/${DEV_DATA_DIR}. This run uses another folder (ORIBOT_DATA_DIR); delete it yourself if you no longer need it.`;
  }
}

/** A file or folder this run would remove for good, before anything on disk is checked. */
export interface DeleteCandidate {
  readonly path: string;
  /** The folder it must stay strictly inside. */
  readonly root: string;
}

/** Every path a reset removes, when it exists and passes `refusalOf`: Ori Bot's own entries in its data folder, then (installed only) its Library files. */
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

export const WORKSPACE_REFUSAL = 'An agent workspace, or holds one. Workspaces are never touched.';

/** What the disk says about a path, read with `lstat` and `realpath`. `unreadable`: either failed for a reason but absence. */
export type PathFacts =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' }
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
  if (!strictlyInside(target, root) || !strictlyInside(target, homeDir)) return "Outside Ori Bot's own folders.";
  if (workspaces.some((workspace) => isWithin(target, workspace) || isWithin(workspace, target))) return WORKSPACE_REFUSAL;
  switch (facts.kind) {
    case 'unreadable':
      return 'Ori Bot could not check it, so it stays.';
    case 'symlink':
      return 'A symbolic link. Ori Bot does not follow it.';
    case 'present':
      return facts.realPath === target ? null : 'Reached through a symbolic link. Ori Bot does not follow it.';
  }
}

/** Where Ori Bot.app may be installed: the system or the user's own Applications folder. */
export const appFoldersOf = (homeDir: string): readonly string[] => ['/Applications', path.join(homeDir, 'Applications')];

/** The app bundle that holds `execPath` (`…/Ori Bot.app/Contents/MacOS/Ori Bot`), or why it cannot be moved to the Trash. */
export function bundleOf(execPath: string, homeDir: string): { readonly kind: 'bundle'; readonly path: string } | { readonly kind: 'refused'; readonly reason: string } {
  const macos = path.dirname(execPath);
  const contents = path.dirname(macos);
  const bundle = path.dirname(contents);
  if (!path.isAbsolute(execPath) || path.normalize(execPath) !== execPath || path.basename(macos) !== 'MacOS' || path.basename(contents) !== 'Contents') {
    return { kind: 'refused', reason: 'Ori Bot is not running from an app bundle.' };
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
