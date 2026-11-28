import { access } from 'node:fs/promises';
import path from 'node:path';
import { keyFileStore, keyFromText, savedFirst, VAULT_KEY_ACCOUNT, VAULT_KEY_SERVICE, type MasterKeyStore } from './master-key.ts';
import { runProgram, type Run, type RunResult } from './run.ts';
import { SecretStoreError } from './secret-store.ts';

const SECRET_TOOL = 'secret-tool';
/**
 * The item's attributes. Unlike the macOS Keychain, the Secret Service has no "add only if absent", so each data
 * folder keeps its own key: the host's lock on its folder then makes sure no two processes ever save the same item.
 */
const attributes = (dataDir: string): readonly string[] => ['service', VAULT_KEY_SERVICE, 'account', VAULT_KEY_ACCOUNT, 'folder', dataDir];

/** `secret-tool lookup` ended cleanly without printing a key: nothing is saved under the attributes. */
const notFound = (result: RunResult): boolean =>
  result.kind === 'exited' && (result.code === 0 || result.code === 1) && result.stdout.trim() === '' && result.stderr.trim() === '';

const exitedWith = (code: number | null): string => (code === null ? 'was stopped before it finished' : `exited with ${String(code)}`);

/**
 * The master key in the freedesktop Secret Service (GNOME Keyring, KWallet), through `secret-tool`. Only a clean
 * "nothing saved" counts as no key; a lookup that times out (an unanswered unlock prompt) or fails is an error, so a
 * locked keyring never leads to a new key replacing the one other data folders use.
 */
export function secretServiceKeyStore(dataDir: string, run: Run = runProgram): MasterKeyStore {
  const load = async (): Promise<Buffer | undefined> => {
    const result = await run(SECRET_TOOL, ['lookup', ...attributes(dataDir)], '');
    if (result.kind === 'missing') throw new SecretStoreError('secret-tool could not be started to read the vault key');
    if (notFound(result)) return undefined;
    if (result.code === 0) return keyFromText(result.stdout, 'The Secret Service item');
    throw new SecretStoreError(`The Secret Service could not read the vault key (secret-tool ${exitedWith(result.code)})`);
  };
  return {
    kind: 'secret-service',
    load,
    create: async (key) => {
      const saved = await load();
      if (saved !== undefined) return saved;
      const result = await run(SECRET_TOOL, ['store', '--label=MorrowBot vault key', ...attributes(dataDir)], key.toString('base64'));
      if (result.kind === 'missing') throw new SecretStoreError('secret-tool could not be started to save the vault key');
      if (result.code !== 0) throw new SecretStoreError(`The Secret Service could not save the vault key (secret-tool ${exitedWith(result.code)})`);
      return savedFirst({ load });
    },
  };
}

/** The Linux key store, and why the plain key file is used when it is. */
export type LinuxKeys =
  | { readonly kind: 'secret-service'; readonly store: MasterKeyStore }
  | { readonly kind: 'headless'; readonly store: MasterKeyStore; readonly reason: string };

/**
 * The Secret Service when `secret-tool` runs and can reach it; otherwise the owner-only `keyFile`. A key file that
 * already exists keeps being used, so a desktop session that appears later never strands the key it holds.
 */
export async function linuxKeys(dataDir: string, run: Run = runProgram): Promise<LinuxKeys> {
  const keyFile = path.join(dataDir, 'vault.key');
  const fallback = (reason: string): LinuxKeys => ({ kind: 'headless', store: keyFileStore(keyFile), reason });
  if (await exists(keyFile)) return fallback('the vault key is in the data folder from an earlier run without a Secret Service');
  const probe = await run(SECRET_TOOL, ['lookup', ...attributes(dataDir)], '');
  if (probe.kind === 'missing') return fallback('secret-tool is not installed');
  if (probe.code === null || probe.code === 0 || notFound(probe)) return { kind: 'secret-service', store: secretServiceKeyStore(dataDir, run) };
  return fallback('the Secret Service is not reachable from this session');
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
