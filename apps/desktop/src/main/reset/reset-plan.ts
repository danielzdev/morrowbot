import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { KeptPath, ResetOption, ResetStep } from '../../renderer/bridge.ts';
import { APP_ID } from '../app-identity.ts';
import type { Keychain } from './keychain.ts';
import { sharesWorkspace, workspaceIdsOf } from './workspace-identity.ts';
import { bundleIdIn, bundleOf, comparable, dataDirRefusal, deleteCandidatesOf, ELECTRON_PROFILE, isWithin, RELEASE_TOKEN, refusalOf, SAFE_STORAGE, VAULT_KEY, VAULT_SECRETS, WORKSPACE_REFUSAL, WORKSPACES_ENTRY, workspacesOf, type KeychainItem, type PathFacts, type ResetContext } from './reset-paths.ts';

/** Where this process runs from, for finding the app bundle. */
export interface BundleInput {
  /** `app.isPackaged`. */
  readonly packaged: boolean;
  readonly execPath: string;
  /** An update is being checked, downloaded or staged: quitting would install it, putting the app back. */
  readonly updatePending: boolean;
}

/** What the data side of a reset removes, or why it cannot run. */
export type DataPlan =
  | { readonly kind: 'ready'; readonly steps: readonly ResetStep[]; readonly kept: readonly KeptPath[] }
  | { readonly kind: 'refused'; readonly reason: string };

/** The two choices that delete data. Only Full uninstall removes the release feed token. */
export type DataChoice = 'reset' | 'full-uninstall';

export type BundlePlan = { readonly kind: 'bundle'; readonly path: string } | { readonly kind: 'refused'; readonly reason: string };

const UPDATE_PENDING = 'An update is on its way. Restart to update, or wait until it is done, then try again.';

const keychainStep = (item: KeychainItem): ResetStep => ({ kind: 'keychain', service: item.service, account: item.account });

const isAbsence = (error: unknown): boolean => error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** `lstat` then `realpath`, without following a final symbolic link. Only ENOENT and ENOTDIR mean missing; any other failure is `unreadable`. */
export async function factsOf(target: string): Promise<PathFacts> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return { kind: 'symlink' };
    return { kind: 'present', realPath: await realpath(target) };
  } catch (error) {
    return isAbsence(error) ? { kind: 'missing' } : { kind: 'unreadable' };
  }
}

async function entriesOf(dir: string): Promise<readonly string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/**
 * Why `target` may not be deleted right now, read from disk again: null only when it is there and passes
 * `refusalOf`. The helper asks this just before each deletion, so a path swapped for a link since the plan,
 * gone, or no longer readable is skipped.
 */
export async function deleteRefusalNow(context: ResetContext, target: string): Promise<string | null> {
  const candidate = deleteCandidatesOf(context).find((each) => each.path === target);
  if (candidate === undefined) return "Not one of Ori Bot's own files.";
  const facts = await factsOf(target);
  if (facts.kind === 'missing') return 'Already gone.';
  const refusal = refusalOf(target, candidate.root, context.homeDir, facts, workspacesOf(context));
  if (refusal !== null) return refusal;
  return (await sharesWorkspace(target, await workspaceIdsOf(workspacesOf(context)))) ? WORKSPACE_REFUSAL : null;
}

/** True only when Electron's profile folder is verifiably gone, so its Safe Storage key protects nothing any more. */
export async function electronProfileGone(context: ResetContext): Promise<boolean> {
  return (await factsOf(path.join(context.homeDir, ELECTRON_PROFILE))).kind === 'missing';
}

/**
 * The files, folders and Keychain items a reset removes, each checked on disk now, plus what stays.
 * Only macOS; never while the host cannot list its agents' workspaces.
 */
export async function dataPlanOf(context: ResetContext, choice: DataChoice, keychain: Keychain): Promise<DataPlan> {
  if (context.platform !== 'darwin') return { kind: 'refused', reason: 'Reset is available on macOS only.' };
  const refusal = dataDirRefusal(context);
  if (refusal !== null) return { kind: 'refused', reason: refusal };
  if (context.workspaces === null) {
    return { kind: 'refused', reason: "Ori Bot can't list which folders its agents use right now, so it deletes nothing. Make sure its server is running and reachable (Settings › Server), then try again." };
  }
  const workspaces = workspacesOf(context);
  const steps: ResetStep[] = [];
  const kept: KeptPath[] = [];
  const ids = await workspaceIdsOf(workspaces);
  for (const candidate of deleteCandidatesOf(context)) {
    const facts = await factsOf(candidate.path);
    if (facts.kind === 'missing') continue;
    const reason = refusalOf(candidate.path, candidate.root, context.homeDir, facts, workspaces) ?? ((await sharesWorkspace(candidate.path, ids)) ? WORKSPACE_REFUSAL : null);
    if (reason === null) steps.push({ kind: 'delete', path: candidate.path });
    else kept.push({ path: candidate.path, reason });
  }
  const own = new Set(deleteCandidatesOf(context).map((candidate) => comparable(candidate.path)));
  for (const name of await entriesOf(context.profile.dataDir)) {
    const entry = path.join(context.profile.dataDir, name);
    if (own.has(comparable(entry))) continue;
    kept.push({ path: entry, reason: comparable(name) === WORKSPACES_ENTRY ? 'Agent workspaces are never touched.' : "Not one of Ori Bot's own files." });
  }
  if (context.profile.kind === 'installed') {
    const electronProfile = path.join(context.homeDir, ELECTRON_PROFILE);
    const profileKept = kept.some((each) => each.path === electronProfile);
    const secrets = comparable(path.join(context.profile.dataDir, VAULT_SECRETS));
    const secretsKept = kept.some((each) => comparable(each.path) === secrets);
    try {
      if (!profileKept && (await keychain.has(SAFE_STORAGE))) steps.push(keychainStep(SAFE_STORAGE));
      if (await keychain.has(VAULT_KEY)) {
        if (secretsKept) kept.push({ path: `Keychain: ${VAULT_KEY.service} (account ${VAULT_KEY.account})`, reason: 'It unlocks the vault secrets that stay.' });
        else steps.push(keychainStep(VAULT_KEY));
      }
      if (await keychain.has(RELEASE_TOKEN)) {
        if (choice === 'full-uninstall') steps.push(keychainStep(RELEASE_TOKEN));
        else kept.push({ path: `Keychain: ${RELEASE_TOKEN.service} (account ${RELEASE_TOKEN.account})`, reason: 'Needed for app updates while Ori Bot stays installed.' });
      }
    } catch (error) {
      return { kind: 'refused', reason: error instanceof Error ? error.message : 'The login Keychain could not be checked.' };
    }
  }
  return { kind: 'ready', steps, kept };
}

/** The installed Ori Bot.app, checked on disk: a real folder in Applications with Ori Bot's bundle id. Never in a development run. */
export async function bundlePlanOf(context: ResetContext, input: BundleInput): Promise<BundlePlan> {
  if (context.platform !== 'darwin') return { kind: 'refused', reason: 'Uninstalling is available on macOS only.' };
  if (context.profile.kind !== 'installed' || !input.packaged) {
    return { kind: 'refused', reason: 'This is a development run. Uninstalling is offered only in the installed Ori Bot.app.' };
  }
  if (input.updatePending) return { kind: 'refused', reason: UPDATE_PENDING };
  const bundle = bundleOf(input.execPath, context.homeDir);
  if (bundle.kind === 'refused') return bundle;
  const facts = await factsOf(bundle.path);
  if (facts.kind !== 'present' || facts.realPath !== bundle.path) return { kind: 'refused', reason: 'Ori Bot.app is a symbolic link or could not be checked.' };
  const plist = await readFile(path.join(bundle.path, 'Contents', 'Info.plist'), 'utf8').catch(() => '');
  if (bundleIdIn(plist) !== APP_ID) return { kind: 'refused', reason: `This app bundle is not ${APP_ID}.` };
  const known = context.workspaces ?? [];
  if (known.some((workspace) => isWithin(workspace, bundle.path) || isWithin(bundle.path, workspace)) || (await sharesWorkspace(bundle.path, await workspaceIdsOf(known)))) {
    return { kind: 'refused', reason: 'An agent workspace is inside Ori Bot.app, or holds it. Move that workspace first.' };
  }
  return bundle;
}

/** Every reset and uninstall choice, resolved to exact paths and Keychain items right now. */
export async function resetOptionsOf(context: ResetContext, input: BundleInput, keychain: Keychain): Promise<readonly ResetOption[]> {
  const [data, full, bundle] = await Promise.all([dataPlanOf(context, 'reset', keychain), dataPlanOf(context, 'full-uninstall', keychain), bundlePlanOf(context, input)]);
  const trash: ResetStep[] = bundle.kind === 'bundle' ? [{ kind: 'trash', path: bundle.path }] : [];
  const unavailable = (choice: ResetOption['choice'], reason: string): ResetOption => ({ kind: 'unavailable', choice, reason });
  const keepData: KeptPath[] = [{ path: context.profile.dataDir, reason: 'Your agents, chats and settings stay for when you reinstall.' }];
  return [
    data.kind === 'refused'
      ? unavailable('reset', data.reason)
      : context.profile.kind === 'installed' && input.updatePending
        ? unavailable('reset', UPDATE_PENDING)
        : { kind: 'available', choice: 'reset', steps: data.steps, kept: data.kept },
    bundle.kind === 'bundle' ? { kind: 'available', choice: 'uninstall-app', steps: trash, kept: keepData } : unavailable('uninstall-app', bundle.reason),
    bundle.kind === 'refused'
      ? unavailable('full-uninstall', bundle.reason)
      : full.kind === 'refused'
        ? unavailable('full-uninstall', full.reason)
        : { kind: 'available', choice: 'full-uninstall', steps: [...trash, ...full.steps], kept: full.kept },
  ];
}
