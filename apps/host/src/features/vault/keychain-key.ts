import { keyFromText, savedFirst, VAULT_KEY_ACCOUNT, VAULT_KEY_SERVICE, type MasterKeyStore } from './master-key.ts';
import { runProgram, type Run } from './run.ts';
import { SecretStoreError } from './secret-store.ts';

const SECURITY = '/usr/bin/security';
/** `security` exits with these when the item is not in the Keychain, and when adding one that is. */
const NOT_FOUND = 44;
const ALREADY_THERE = 45;
const PLAIN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * The master key in the macOS login Keychain, which the login session unlocks. It is written on the stdin of
 * `security -i`, so it never shows up in a process list; `security`'s stderr is never passed on.
 */
export function keychainKeyStore(service: string = VAULT_KEY_SERVICE, run: Run = runProgram): MasterKeyStore {
  if (!PLAIN.test(service)) throw new SecretStoreError('The Keychain service name is not a plain name');
  const load = async (): Promise<Buffer | undefined> => {
    const result = await run(SECURITY, ['find-generic-password', '-s', service, '-a', VAULT_KEY_ACCOUNT, '-w'], '');
    if (result.kind === 'missing') throw new SecretStoreError('The macOS Keychain tool could not be started');
    if (result.code === NOT_FOUND) return undefined;
    if (result.code !== 0) throw failed('read', result.code);
    return keyFromText(result.stdout, 'The Keychain item');
  };
  return {
    kind: 'keychain',
    load,
    create: async (key) => {
      const result = await run(SECURITY, ['-i'], `add-generic-password -s ${service} -a ${VAULT_KEY_ACCOUNT} -w ${key.toString('base64')}\n`);
      if (result.kind === 'missing') throw new SecretStoreError('The macOS Keychain tool could not be started');
      if (result.code === ALREADY_THERE) return savedFirst({ load });
      if (result.code !== 0) throw failed('save', result.code);
      return key;
    },
  };
}

const failed = (action: string, code: number | null): SecretStoreError =>
  new SecretStoreError(`The macOS Keychain could not ${action} the vault key (security exited with ${code === null ? 'a signal' : String(code)})`);
