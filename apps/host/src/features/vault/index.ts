import path from 'node:path';
import { encryptedFileStore } from './file-store.ts';
import { keychainStore } from './keychain-store.ts';
import type { SecretStore } from './secret-store.ts';

export { KEYCHAIN_SERVICE } from './keychain-store.ts';
export type { SecretStore } from './secret-store.ts';
export { openVault } from './vault-service.ts';
export type { ResolvedVaultItem, VaultSave, VaultService } from './vault-service.ts';

/** Where vault secrets are kept: the macOS login Keychain, or an AES-256-GCM file in the data folder. */
export type VaultStoreChoice = 'keychain' | 'file';

/** The store a host on `platform` uses when none is chosen: the Keychain on macOS, the sealed file elsewhere. */
export const defaultVaultStore = (platform: NodeJS.Platform): VaultStoreChoice => (platform === 'darwin' ? 'keychain' : 'file');

export function secretStore(choice: VaultStoreChoice, dataDir: string): SecretStore {
  switch (choice) {
    case 'keychain':
      return keychainStore();
    case 'file':
      return encryptedFileStore({ file: path.join(dataDir, 'vault-secrets.json'), keyFile: path.join(dataDir, 'vault.key') });
  }
}
