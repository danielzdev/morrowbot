import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { writeFileOnce } from './atomic-file.ts';
import { SecretStoreError } from './secret-store.ts';

export const MASTER_KEY_BYTES = 32;

/** The OS keystore entry (Keychain service, Secret Service attribute) holding the master key. */
export const VAULT_KEY_SERVICE = 'com.legendarykoi.oribot.vault';
export const VAULT_KEY_ACCOUNT = 'master-key';

/** Where the one master key that unlocks `vault-secrets.json` is kept. */
export type MasterKeyKind = 'keychain' | 'dpapi' | 'secret-service' | 'key-file';

/** Keeps the vault's single 256-bit master key. Neither method ever puts key bytes into an error. */
export interface MasterKeyStore {
  readonly kind: MasterKeyKind;
  /** The saved key, or undefined when none has been saved yet. */
  load(): Promise<Buffer | undefined>;
  /**
   * Saves `key` unless a key is saved already, and returns the key that is saved now. It never replaces a saved key:
   * every data folder on this account shares the keystore entry, and replacing it would strand their secrets.
   */
  create(key: Buffer): Promise<Buffer>;
}

export const newMasterKey = (): Buffer => randomBytes(MASTER_KEY_BYTES);

/** The key another process saved first, read back after `create` found one in place. */
export async function savedFirst(store: Pick<MasterKeyStore, 'load'>): Promise<Buffer> {
  const saved = await store.load();
  if (saved === undefined) throw new SecretStoreError('The vault key was saved by another process but cannot be read back');
  return saved;
}

/** The key written as base64 text, checked to be exactly 256 bits. */
export function keyFromText(text: string, where: string): Buffer {
  const key = Buffer.from(text.trim(), 'base64');
  if (key.length !== MASTER_KEY_BYTES) throw new SecretStoreError(`${where} does not hold a 256-bit vault key`);
  return key;
}

/**
 * The key as base64 in an owner-only file. It keeps the key out of copies of `vault-secrets.json` alone, not from
 * someone who can read the data folder: the fallback for Linux without a Secret Service, and for tests.
 */
export function keyFileStore(file: string): MasterKeyStore {
  const load = async (): Promise<Buffer | undefined> => {
    const text = await readIfThere(file);
    return text === undefined ? undefined : keyFromText(text, 'The vault key file');
  };
  return {
    kind: 'key-file',
    load,
    create: async (key) => ((await writeFileOnce(file, `${key.toString('base64')}\n`)) ? key : savedFirst({ load })),
  };
}

export async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
