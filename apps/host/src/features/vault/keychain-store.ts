import { spawn } from 'node:child_process';
import { SAVED, SecretStoreError, type SecretStore } from './secret-store.ts';

/** The login Keychain service every vault secret is saved under, one generic password per item id. */
export const KEYCHAIN_SERVICE = 'com.legendarykoi.morrowbot.vault';

const SECURITY = '/usr/bin/security';
/** `security` exits with this when the item is not in the Keychain. */
const NOT_FOUND = 44;
/** `security -i` reads at most 4096 bytes per command line and runs the rest of a longer one as a new command. */
const MAX_COMMAND_LINE = 4000;
const TIMEOUT_MS = 15_000;
/** What `security -i` would split or misread: only plain tokens go on its command line. */
const PLAIN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Secrets in the macOS login Keychain, via `/usr/bin/security`. A value is written base64-encoded on the
 * stdin of `security -i`, so it never shows up in a process list, and read back with `find-generic-password -w`.
 */
export function keychainStore(service: string = KEYCHAIN_SERVICE): SecretStore {
  const plain = (value: string): string => {
    if (!PLAIN.test(value)) throw new SecretStoreError('A vault id or service name is not safe to pass to the Keychain');
    return value;
  };
  plain(service);
  return {
    read: async (id) => {
      const { code, stdout } = await security(['find-generic-password', '-s', service, '-a', plain(id), '-w'], null);
      if (code === NOT_FOUND) return undefined;
      if (code !== 0) throw failed('read', code);
      return Buffer.from(stdout.trim(), 'base64').toString('utf8');
    },
    write: async (id, secret) => {
      const line = `add-generic-password -U -s ${service} -a ${plain(id)} -w ${Buffer.from(secret, 'utf8').toString('base64')}\n`;
      if (Buffer.byteLength(line) > MAX_COMMAND_LINE) return { kind: 'too-long' };
      const { code } = await security(['-i'], line);
      if (code !== 0) throw failed('save', code);
      return SAVED;
    },
    remove: async (id) => {
      const { code } = await security(['delete-generic-password', '-s', service, '-a', plain(id)], null);
      if (code !== 0 && code !== NOT_FOUND) throw failed('delete', code);
    },
  };
}

const failed = (action: string, code: number | null): SecretStoreError =>
  new SecretStoreError(`The macOS Keychain could not ${action} a vault secret (security exited with ${code === null ? 'a signal' : String(code)})`);

/** Runs `security`, keeping stdout and dropping stderr, which can echo what it was given. */
function security(args: readonly string[], input: string | null): Promise<{ readonly code: number | null; readonly stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY, args, { stdio: ['pipe', 'pipe', 'ignore'], timeout: TIMEOUT_MS });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', () => {
      reject(new SecretStoreError('The macOS Keychain tool could not be started'));
    });
    child.once('close', (code) => {
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });
}
