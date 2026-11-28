import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { KeychainItem } from './reset-paths.ts';

/** The login Keychain, one exact item (service and account) at a time. */
export interface Keychain {
  /** Throws when the login Keychain cannot be searched, so an unknown answer never counts as absent. */
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

/**
 * The arguments naming one item in the login Keychain file. `security` searches the whole search list when it
 * cannot open a named Keychain, so the file must be there first.
 */
async function itemArgs(item: KeychainItem): Promise<string[]> {
  const login = path.join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
  const stats = await lstat(login).catch(() => null);
  if (stats === null || !stats.isFile()) throw new Error('The login Keychain is missing, so Ori Bot leaves the Keychain alone.');
  return ['-s', item.service, '-a', item.account, login];
}

/** The macOS login Keychain through the `security` tool. */
export const MAC_KEYCHAIN: Keychain = {
  has: async (item) => {
    const code = await security(['find-generic-password', ...(await itemArgs(item))]);
    if (code !== 0 && code !== NOT_FOUND) throw new Error(`The Keychain could not be searched for ${item.service} (security exited ${String(code)}).`);
    return code === 0;
  },
  remove: async (item) => {
    const code = await security(['delete-generic-password', ...(await itemArgs(item))]);
    if (code !== 0 && code !== NOT_FOUND) throw new Error(`The Keychain refused to delete ${item.service} (security exited ${String(code)}).`);
  },
};
