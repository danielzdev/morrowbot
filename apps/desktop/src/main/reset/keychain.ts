import { execFile } from 'node:child_process';

/** The login Keychain, by service name only. */
export interface Keychain {
  has(service: string): Promise<boolean>;
  /** Deletes every generic password item with this service. */
  remove(service: string): Promise<void>;
}

const MAX_ITEMS = 20;

/** Runs `/usr/bin/security` and answers its exit code; it never reads a secret (no `-w` or `-g`). */
function security(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', args, { timeout: 10_000 }, (error) => {
      resolve(error === null ? 0 : typeof error.code === 'number' ? error.code : 1);
    });
  });
}

/** The macOS login Keychain through the `security` tool. */
export const MAC_KEYCHAIN: Keychain = {
  has: async (service) => (await security(['find-generic-password', '-s', service])) === 0,
  remove: async (service) => {
    for (let item = 0; item < MAX_ITEMS; item += 1) {
      if ((await security(['delete-generic-password', '-s', service])) !== 0) return;
    }
  },
};
