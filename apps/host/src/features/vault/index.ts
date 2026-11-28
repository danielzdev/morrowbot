import path from 'node:path';
import { dpapiKeyStore } from './dpapi-key.ts';
import { encryptedFileStore } from './file-store.ts';
import { keychainKeyStore } from './keychain-key.ts';
import { keyFileStore, type MasterKeyStore } from './master-key.ts';
import { linuxKeys } from './secret-service-key.ts';
import type { SecretStore } from './secret-store.ts';

export { VAULT_KEY_ACCOUNT, VAULT_KEY_SERVICE } from './master-key.ts';
export type { MasterKeyKind, MasterKeyStore } from './master-key.ts';
export type { SecretStore } from './secret-store.ts';
export { openVault } from './vault-service.ts';
export type { ResolvedVaultItem, VaultSave, VaultService } from './vault-service.ts';

/** Where the vault's master key lives: the OS keystore, or (tests) an owner-only file in the data folder. */
export type VaultKeyChoice = 'system' | 'file';

/** The vault's secrets backend, and whether its master key fell back to a plain file in the data folder. */
export interface VaultBackend {
  readonly secrets: SecretStore;
  readonly keys: MasterKeyStore['kind'];
  /** Why the key sits in a plain file although the OS keystore was asked for; null when it did not fall back. */
  readonly headless: string | null;
}

/**
 * One AES-256-GCM file, `<dataDir>/vault-secrets.json`, unlocked by one master key: in the macOS login Keychain,
 * wrapped with Windows DPAPI in `vault.key.dpapi`, in the Linux Secret Service, or else in `vault.key`.
 */
export async function vaultBackend(choice: VaultKeyChoice, platform: NodeJS.Platform, dataDir: string): Promise<VaultBackend> {
  const backend = (keys: MasterKeyStore, headless: string | null): VaultBackend => ({
    secrets: encryptedFileStore({ file: path.join(dataDir, 'vault-secrets.json'), keys }),
    keys: keys.kind,
    headless,
  });
  const keyFile = path.join(dataDir, 'vault.key');
  if (choice === 'file') return backend(keyFileStore(keyFile), null);
  if (platform === 'darwin') return backend(keychainKeyStore(), null);
  if (platform === 'win32') return backend(dpapiKeyStore(path.join(dataDir, 'vault.key.dpapi')), null);
  const linux = await linuxKeys(keyFile);
  return backend(linux.store, linux.kind === 'headless' ? linux.reason : null);
}
