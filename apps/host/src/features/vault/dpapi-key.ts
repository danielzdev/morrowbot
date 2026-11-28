import { writeFileOnce } from './atomic-file.ts';
import { keyFromText, readIfThere, savedFirst, type MasterKeyStore } from './master-key.ts';
import { runProgram, type Run } from './run.ts';
import { SecretStoreError } from './secret-store.ts';

const POWERSHELL = 'powershell.exe';

/** Reads base64 on stdin, runs DPAPI `Protect` or `Unprotect` for the current Windows user, writes base64 to stdout. */
function script(action: 'Protect' | 'Unprotect'): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    `$out = [System.Security.Cryptography.ProtectedData]::${action}($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
}

/** PowerShell's `-EncodedCommand` form (UTF-16LE base64), so the script needs no quoting. */
export const dpapiArgs = (action: 'Protect' | 'Unprotect'): readonly string[] => [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(script(action), 'utf16le').toString('base64'),
];

/**
 * The master key wrapped with Windows DPAPI for the current user (`ProtectedData`, `CurrentUser` scope) in
 * `vault.key.dpapi`: only this Windows account can unwrap it, and the plain key is never written to disk.
 */
export function dpapiKeyStore(file: string, run: Run = runProgram): MasterKeyStore {
  const powershell = async (action: 'Protect' | 'Unprotect', input: string): Promise<string> => {
    const result = await run(POWERSHELL, dpapiArgs(action), input);
    if (result.kind === 'missing') throw new SecretStoreError('Windows PowerShell could not be started to open the vault key');
    if (result.code !== 0) throw new SecretStoreError(`Windows DPAPI could not ${action.toLowerCase()} the vault key (PowerShell exited with ${String(result.code)})`);
    return result.stdout.trim();
  };
  const load = async (): Promise<Buffer | undefined> => {
    const wrapped = await readIfThere(file);
    return wrapped === undefined ? undefined : keyFromText(await powershell('Unprotect', wrapped.trim()), 'The DPAPI-wrapped key');
  };
  return {
    kind: 'dpapi',
    load,
    create: async (key) => {
      const wrapped = await powershell('Protect', key.toString('base64'));
      if (wrapped === '') throw new SecretStoreError('Windows DPAPI returned no wrapped key');
      return (await writeFileOnce(file, `${wrapped}\n`)) ? key : savedFirst({ load });
    },
  };
}
