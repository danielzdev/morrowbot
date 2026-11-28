import { access } from 'node:fs/promises';
import { keyFileStore, keyFromText, VAULT_KEY_ACCOUNT, VAULT_KEY_SERVICE, type MasterKeyStore } from './master-key.ts';
import { runProgram, type Run } from './run.ts';
import { SecretStoreError } from './secret-store.ts';

const SECRET_TOOL = 'secret-tool';
const ATTRIBUTES = ['service', VAULT_KEY_SERVICE, 'account', VAULT_KEY_ACCOUNT] as const;

/** The master key in the freedesktop Secret Service (GNOME Keyring, KWallet), through `secret-tool`. */
export function secretServiceKeyStore(run: Run = runProgram): MasterKeyStore {
  return {
    kind: 'secret-service',
    load: async () => {
      const result = await run(SECRET_TOOL, ['lookup', ...ATTRIBUTES], '');
      if (result.kind === 'missing') throw new SecretStoreError('secret-tool could not be started to read the vault key');
      if (result.code === 0 && result.stdout.trim() !== '') return keyFromText(result.stdout, 'The Secret Service item');
      if (result.stderr.trim() === '') return undefined;
      throw new SecretStoreError(`The Secret Service could not read the vault key (secret-tool exited with ${String(result.code)})`);
    },
    save: async (key) => {
      const result = await run(SECRET_TOOL, ['store', '--label=MorrowBot vault key', ...ATTRIBUTES], key.toString('base64'));
      if (result.kind === 'missing') throw new SecretStoreError('secret-tool could not be started to save the vault key');
      if (result.code !== 0) throw new SecretStoreError(`The Secret Service could not save the vault key (secret-tool exited with ${String(result.code)})`);
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
export async function linuxKeys(keyFile: string, run: Run = runProgram): Promise<LinuxKeys> {
  const fallback = (reason: string): LinuxKeys => ({ kind: 'headless', store: keyFileStore(keyFile), reason });
  if (await exists(keyFile)) return fallback('the vault key is in the data folder from an earlier run without a Secret Service');
  const probe = await run(SECRET_TOOL, ['lookup', ...ATTRIBUTES], '');
  if (probe.kind === 'missing') return fallback('secret-tool is not installed');
  if (probe.code === 0 || probe.stderr.trim() === '') return { kind: 'secret-service', store: secretServiceKeyStore(run) };
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
