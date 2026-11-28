import { listDirectory, readOptionalFile, z, type PluginRuntime } from '@morrowbot/plugin-sdk';

/**
 * Where the managed-policy check looks. `root` prefixes the system paths: '/' in the app, a
 * temporary folder in tests. The Claude config folder comes from `env` as it is. `run` runs
 * `plutil` for the macOS managed preferences.
 */
export interface PolicyScope {
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: string;
  readonly run: PluginRuntime['runCommand'];
}

/** Whether admin-managed Claude Code policy could apply. Any managed source at all withholds every profile. */
export type Policy = { readonly kind: 'clear' } | { readonly kind: 'withheld'; readonly reason: string };

/** Claude Code 2.1.332 reads at most 2 MB from a managed source. */
const MAX_SOURCE_BYTES = 2_097_152;
const PLUTIL_TIMEOUT_MS = 10_000;
const PREFERENCES_DOMAIN = 'com.anthropic.claudecode';

const CLEAR: Policy = { kind: 'clear' };

export function systemScope(runtime: PluginRuntime): PolicyScope {
  return { root: '/', env: runtime.env, platform: runtime.platform, run: (command, options) => runtime.runCommand(command, options) };
}

/**
 * Checks every source of admin-managed Claude Code settings, as Claude Code 2.1.332 finds them:
 * the system managed folder, the macOS managed preferences, and the server-managed settings caches
 * in the Claude config folder. A source that is absent or empty is fine; any content, or a source
 * that exists but cannot be read, withholds. Personal settings (`~/.claude/settings.json`) are not
 * policy and are never read.
 */
export async function checkManagedPolicy(scope: PolicyScope): Promise<Policy> {
  const managedDir = managedDirectory(scope.platform);
  if (managedDir === null) {
    return withheld(`MorrowBot cannot check Claude Code's managed settings on ${scope.platform}.`);
  }
  const configDir = configDirectory(scope.env);
  if (configDir === null) {
    return withheld('MorrowBot cannot find the Claude config folder: neither CLAUDE_CONFIG_DIR nor HOME is set.');
  }
  const checks: (() => Promise<Policy>)[] = [() => checkDirectory(scope.root, managedDir)];
  if (scope.platform === 'darwin') {
    const user = scope.env.USER ?? '';
    if (user === '') return withheld("MorrowBot cannot check this user's managed Claude Code preferences: USER is not set.");
    for (const plist of managedPreferences(user)) checks.push(() => checkPlist(scope, plist));
  }
  checks.push(
    () => checkJsonFile(`${configDir}/remote-settings.json`, 'server-managed settings'),
    () => checkJsonFile(`${configDir}/state/hybrid-settings.json`, 'server-managed settings'),
  );
  for (const check of checks) {
    const policy = await check();
    if (policy.kind === 'withheld') return policy;
  }
  return CLEAR;
}

function managedDirectory(platform: string): string | null {
  switch (platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode';
    case 'linux':
      return '/etc/claude-code';
    default:
      return null;
  }
}

function configDirectory(env: PolicyScope['env']): string | null {
  const configured = env.CLAUDE_CONFIG_DIR ?? '';
  if (configured !== '') return stripSlashes(configured);
  const home = env.HOME ?? '';
  return home === '' ? null : `${stripSlashes(home)}/.claude`;
}

/** Claude Code skips the per-user file when the user name could not name a folder. */
function managedPreferences(user: string): string[] {
  const device = `/Library/Managed Preferences/${PREFERENCES_DOMAIN}.plist`;
  if (['.', '..'].includes(user) || /[/\p{Cc}]/u.test(user)) return [device];
  return [`/Library/Managed Preferences/${user}/${PREFERENCES_DOMAIN}.plist`, device];
}

async function checkDirectory(root: string, dir: string): Promise<Policy> {
  try {
    const entries = await listDirectory(under(root, dir));
    if (entries === null || entries.length === 0) return CLEAR;
    return withheld(`Claude Code managed settings are installed in ${dir} (${entries.join(', ')}).`);
  } catch (error) {
    return withheld(`MorrowBot could not read ${dir}: ${describe(error)}`);
  }
}

async function checkPlist(scope: PolicyScope, plist: string): Promise<Policy> {
  const file = under(scope.root, plist);
  try {
    if ((await readOptionalFile(file, { maxBytes: MAX_SOURCE_BYTES })) === null) return CLEAR;
    return hasKeys(await plistAsJson(scope.run, file)) ? withheld(`Claude Code managed preferences are set in ${plist}.`) : CLEAR;
  } catch (error) {
    return withheld(`MorrowBot could not read ${plist}: ${describe(error)}`);
  }
}

async function checkJsonFile(file: string, what: string): Promise<Policy> {
  try {
    const text = await readOptionalFile(file, { maxBytes: MAX_SOURCE_BYTES });
    if (text === null || text.trim() === '') return CLEAR;
    return hasKeys(JSON.parse(text)) ? withheld(`Claude Code ${what} are cached in ${file}.`) : CLEAR;
  } catch (error) {
    return withheld(`MorrowBot could not read ${file}: ${describe(error)}`);
  }
}

async function plistAsJson(run: PolicyScope['run'], file: string): Promise<unknown> {
  let output = '';
  const signal = AbortSignal.timeout(PLUTIL_TIMEOUT_MS);
  const exit = await run('/usr/bin/plutil', {
    args: ['-convert', 'json', '-o', '-', '--', file],
    cwd: '/',
    input: '',
    files: [],
    scope: { kind: 'probe' },
    signal,
    onLine: (line) => {
      output += `${line}\n`;
    },
  });
  if (signal.aborted) throw new Error('plutil did not answer within 10 seconds');
  switch (exit.kind) {
    case 'not-found':
      throw new Error('/usr/bin/plutil was not found');
    case 'failed':
      throw new Error(exit.message);
    case 'exited':
      if (exit.code !== 0) {
        const detail = exit.stderr.trim() !== '' ? exit.stderr.trim() : output.trim();
        throw new Error(`plutil exited with code ${String(exit.code)}: ${detail}`);
      }
      return JSON.parse(output);
  }
}

/** Anything but `{}` counts as content: a policy key Claude Code adds later must withhold too. */
function hasKeys(value: unknown): boolean {
  return !z.strictObject({}).safeParse(value).success;
}

function under(root: string, file: string): string {
  return root === '/' ? file : `${stripSlashes(root)}${file}`;
}

function stripSlashes(dir: string): string {
  return dir.length > 1 ? dir.replace(/\/+$/, '') : dir;
}

function withheld(reason: string): Policy {
  return { kind: 'withheld', reason };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
