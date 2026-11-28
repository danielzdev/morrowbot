import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './saved-hosts.ts';

/** Device tokens stay on this device: never in iCloud Keychain or a backup restored elsewhere. */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const keychainStore: SecretStore = {
  read: (key) => SecureStore.getItemAsync(key, OPTIONS),
  write: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
