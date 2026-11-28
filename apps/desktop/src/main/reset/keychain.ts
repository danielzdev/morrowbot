import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import type { KeychainItem } from './reset-paths.ts';

/** The login Keychain, one exact item (service and account) at a time. */
export interface Keychain {
  has(item: KeychainItem): Promise<boolean>;
  /** Deletes the item; throws when it is there and could not be deleted (locked, access denied). */
  remove(item: KeychainItem): Promise<void>;
}

/** `security`'s exit code for errSecItemNotFound. */
const NOT_FOUND = 44;

/** Runs `/usr/bin/security` and answers its exit code; it never reads a secret (no `-w` or `-g`). */
function security(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', args, { timeout: 10_000 }, (error) => {
      resolve(error === null ? 0 : typeof error.code === 'number' ? error.code : 1);
    });
  });
}

const loginKeychain = (): string => path.join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
const itemArgs = (item: KeychainItem): string[] => ['-s', item.service, '-a', item.account, loginKeychain()];

/** The macOS login Keychain through the `security` tool. */
export const MAC_KEYCHAIN: Keychain = {
  has: async (item) => (await security(['find-generic-password', ...itemArgs(item)])) === 0,
  remove: async (item) => {
    const code = await security(['delete-generic-password', ...itemArgs(item)]);
    if (code !== 0 && code !== NOT_FOUND) throw new Error(`The Keychain refused to delete ${item.service} (security exited ${String(code)}).`);
  },
};
