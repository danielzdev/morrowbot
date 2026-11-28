import { standaloneRuntime } from '@morrowbot/plugin-sdk';
import { afterEach, expect, it } from 'vitest';
import { checkManagedConfig } from './managed.ts';

const { runCommand } = standaloneRuntime();

/** Runs a shell script with `params` as $1, $2, …: plugin tests reach the file system only through commands. */
async function sh(script: string, ...params: string[]): Promise<string> {
  let output = '';
  const exit = await runCommand('/bin/sh', {
    args: ['-c', script, 'sh', ...params],
    cwd: '/',
    input: '',
    files: [],
    scope: { kind: 'probe' },
    signal: AbortSignal.timeout(10_000),
    onLine: (line) => {
      output += `${line}\n`;
    },
  });
  if (exit.kind !== 'exited' || exit.code !== 0) throw new Error(`sh failed: ${JSON.stringify(exit)}`);
  return output.trim();
}

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await sh('chmod -R u+rwx "$1" && rm -rf "$1"', root);
});

/** A temporary root holding `paths` (a trailing `/` makes a folder), with `locked` made unreadable; the result of checking it on `platform`. */
async function check(paths: readonly string[], options: { readonly platform?: string; readonly locked?: string } = {}): Promise<string> {
  const root = await sh('mktemp -d');
  roots.push(root);
  for (const entry of paths) await sh('mkdir -p "$1$(dirname "$2")" && case "$2" in */) mkdir -p "$1$2";; *) : > "$1$2";; esac', root, entry);
  if (options.locked !== undefined) await sh('mkdir -p "$1$2" && chmod 000 "$1$2"', root, options.locked);
  const managed = await checkManagedConfig(root, options.platform ?? 'darwin');
  return managed.kind === 'clear' ? 'clear' : managed.reason;
}

it('withholds on any managed opencode config: an entry in the system folder, or a managed preferences file for everyone or any user', async () => {
  expect({
    nothing: await check([]),
    emptySystemFolder: await check(['/Library/Application Support/opencode/']),
    systemFolder: await check(['/Library/Application Support/opencode/opencode.json']),
    preferences: await check(['/Library/Managed Preferences/ai.opencode.managed.plist']),
    userPreferences: await check(['/Library/Managed Preferences/me/ai.opencode.managed.plist']),
    anotherUserPreferences: await check(['/Library/Managed Preferences/me/com.example.other.plist', '/Library/Managed Preferences/someone/ai.opencode.managed.plist']),
    otherDomain: await check(['/Library/Managed Preferences/com.example.other.plist', '/Library/Managed Preferences/me/com.example.other.plist']),
    unreadableUserFolder: await check([], { locked: '/Library/Managed Preferences/someone' }),
    otherCase: await check(['/Library/Managed Preferences/someone/AI.OpenCode.Managed.plist']),
    strayFile: await check(['/Library/Managed Preferences/.DS_Store', '/Library/Managed Preferences/README']),
    unreadable: await check([], { locked: '/Library/Application Support/opencode' }),
    linux: await check(['/etc/opencode/opencode.json'], { platform: 'linux' }),
  }).toMatchInlineSnapshot(`
    {
      "anotherUserPreferences": "This computer has managed opencode config (/Library/Managed Preferences/someone/ai.opencode.managed.plist), which outranks the read-only config Ori Bot gives OpenCode. Ask your admin, or chat with another provider.",
      "emptySystemFolder": "clear",
      "linux": "This computer has managed opencode config (/etc/opencode), which outranks the read-only config Ori Bot gives OpenCode. Ask your admin, or chat with another provider.",
      "nothing": "clear",
      "otherCase": "This computer has managed opencode config (/Library/Managed Preferences/someone/ai.opencode.managed.plist), which outranks the read-only config Ori Bot gives OpenCode. Ask your admin, or chat with another provider.",
      "otherDomain": "clear",
      "preferences": "This computer has managed opencode config (/Library/Managed Preferences/ai.opencode.managed.plist), which outranks the read-only config Ori Bot gives OpenCode. Ask your admin, or chat with another provider.",
      "strayFile": "clear",
      "systemFolder": "This computer has managed opencode config (/Library/Application Support/opencode), which outranks the read-only config Ori Bot gives OpenCode. Ask your admin, or chat with another provider.",
      "unreadable": "Ori Bot could not check this computer's managed opencode config, which outranks the read-only config Ori Bot gives OpenCode.",
      "unreadableUserFolder": "Ori Bot could not check this computer's managed opencode config, which outranks the read-only config Ori Bot gives OpenCode.",
      "userPreferences": "This computer has managed opencode config (/Library/Managed Preferences/me/ai.opencode.managed.plist), which outranks the read-only config Ori Bot gives OpenCode. Ask your admin, or chat with another provider.",
    }
  `);
});
