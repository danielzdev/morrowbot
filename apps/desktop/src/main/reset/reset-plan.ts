import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { KeptPath, ResetOption, ResetStep } from '../../renderer/bridge.ts';
import { APP_ID } from '../app-identity.ts';
import type { Keychain } from './keychain.ts';
import { bundleIdIn, bundleOf, dataDirRefusal, deleteCandidatesOf, KEYCHAIN_SERVICES, refusalOf, WORKSPACES_ENTRY, workspacesOf, type PathFacts, type ResetContext } from './reset-paths.ts';

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

type BundlePlan = { readonly kind: 'bundle'; readonly path: string } | { readonly kind: 'refused'; readonly reason: string };

/** `lstat` then `realpath`, without following a final symbolic link. Anything unreadable counts as missing, so it is never touched. */
export async function factsOf(target: string): Promise<PathFacts> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return { kind: 'symlink' };
    return { kind: 'present', realPath: await realpath(target) };
  } catch {
    return { kind: 'missing' };
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
 * The files, folders and Keychain items a reset removes, each checked on disk now, plus what stays.
 * Only macOS; never while the host cannot list its agents' workspaces.
 */
export async function dataPlanOf(context: ResetContext, keychain: Keychain): Promise<DataPlan> {
  if (context.platform !== 'darwin') return { kind: 'refused', reason: 'Reset is available on macOS only.' };
  const refusal = dataDirRefusal(context);
  if (refusal !== null) return { kind: 'refused', reason: refusal };
  if (context.workspaces === null) {
    return { kind: 'refused', reason: "MorrowBot's host isn't running, so it can't check which folders your agents use. Restart MorrowBot and try again." };
  }
  const workspaces = workspacesOf(context);
  const steps: ResetStep[] = [];
  const kept: KeptPath[] = [];
  for (const candidate of deleteCandidatesOf(context)) {
    const facts = await factsOf(candidate.path);
    if (facts.kind === 'missing') continue;
    const reason = refusalOf(candidate.path, candidate.root, context.homeDir, facts, workspaces);
    if (reason === null) steps.push({ kind: 'delete', path: candidate.path });
    else kept.push({ path: candidate.path, reason });
  }
  const own = new Set(deleteCandidatesOf(context).map((candidate) => candidate.path));
  for (const name of await entriesOf(context.profile.dataDir)) {
    const entry = path.join(context.profile.dataDir, name);
    if (own.has(entry)) continue;
    kept.push({ path: entry, reason: name === WORKSPACES_ENTRY ? 'Agent workspaces are never touched.' : "Not one of MorrowBot's own files." });
  }
  if (context.profile.kind === 'installed') {
    for (const service of KEYCHAIN_SERVICES) if (await keychain.has(service)) steps.push({ kind: 'keychain', service });
  }
  return { kind: 'ready', steps, kept };
}

/** The installed MorrowBot.app, checked on disk: a real folder in Applications with MorrowBot's bundle id. Never in a development run. */
async function bundlePlanOf(context: ResetContext, input: BundleInput): Promise<BundlePlan> {
  if (context.platform !== 'darwin') return { kind: 'refused', reason: 'Uninstalling is available on macOS only.' };
  if (context.profile.kind !== 'installed' || !input.packaged) {
    return { kind: 'refused', reason: 'This is a development run. Uninstalling is offered only in the installed MorrowBot.app.' };
  }
  if (input.updatePending) return { kind: 'refused', reason: 'An update is on its way. Restart to update, or wait until it is done, then uninstall.' };
  const bundle = bundleOf(input.execPath, context.homeDir);
  if (bundle.kind === 'refused') return bundle;
  const facts = await factsOf(bundle.path);
  if (facts.kind !== 'present' || facts.realPath !== bundle.path) return { kind: 'refused', reason: 'MorrowBot.app is a symbolic link or could not be checked.' };
  const plist = await readFile(path.join(bundle.path, 'Contents', 'Info.plist'), 'utf8').catch(() => '');
  if (bundleIdIn(plist) !== APP_ID) return { kind: 'refused', reason: `This app bundle is not ${APP_ID}.` };
  return bundle;
}

/** Every reset and uninstall choice, resolved to exact paths and Keychain items right now. */
export async function resetOptionsOf(context: ResetContext, input: BundleInput, keychain: Keychain): Promise<readonly ResetOption[]> {
  const [data, bundle] = await Promise.all([dataPlanOf(context, keychain), bundlePlanOf(context, input)]);
  const trash: ResetStep[] = bundle.kind === 'bundle' ? [{ kind: 'trash', path: bundle.path }] : [];
  const unavailable = (choice: ResetOption['choice'], reason: string): ResetOption => ({ kind: 'unavailable', choice, reason });
  const keepData: KeptPath[] = [{ path: context.profile.dataDir, reason: 'Your agents, chats and settings stay for when you reinstall.' }];
  return [
    data.kind === 'ready' ? { kind: 'available', choice: 'reset', steps: data.steps, kept: data.kept } : unavailable('reset', data.reason),
    bundle.kind === 'bundle' ? { kind: 'available', choice: 'uninstall-app', steps: trash, kept: keepData } : unavailable('uninstall-app', bundle.reason),
    bundle.kind === 'refused'
      ? unavailable('full-uninstall', bundle.reason)
      : data.kind === 'refused'
        ? unavailable('full-uninstall', data.reason)
        : { kind: 'available', choice: 'full-uninstall', steps: [...trash, ...data.steps], kept: data.kept },
  ];
}
