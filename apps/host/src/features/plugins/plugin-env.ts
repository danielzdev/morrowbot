import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import type { EnvPreset } from '@morrowbot/contracts';

const CLI_RUNTIME = [
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'LANG',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'DBUS_SESSION_BUS_ADDRESS',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
];
const CLI_RUNTIME_WINDOWS = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP'];
const LOGIN_SHELL_TIMEOUT_MS = 2_000;

/**
 * The environment a plugin process starts with: `PATH` plus its manifest's preset. Under Electron the
 * host adds `ELECTRON_RUN_AS_NODE=1` so the worker (and the SDK's guard) run as Node; the guard removes
 * it again for the CLI. The host's own credential never appears here.
 */
export function pluginEnv(preset: EnvPreset, pathValue: string, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { PATH: pathValue };
  switch (preset) {
    case 'none':
      break;
    case 'cli-runtime': {
      const names = process.platform === 'win32' ? [...CLI_RUNTIME, ...CLI_RUNTIME_WINDOWS] : CLI_RUNTIME;
      for (const name of [...names, ...Object.keys(source).filter((key) => key.startsWith('XDG_'))]) {
        const value = source[name];
        if (value !== undefined) env[name] = value;
      }
      break;
    }
  }
  if (process.versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

/** Standard CLI install directories added after the login-shell PATH so packaged apps launched from the Dock find tools. */
export function fallbackPluginDirs(platform: NodeJS.Platform, home: string, source: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (platform === 'win32') {
    const appData = source.APPDATA;
    return [...(appData !== undefined && appData !== '' ? [path.join(appData, 'npm')] : []), path.join(home, '.local', 'bin')];
  }
  const shared = [
    path.join(home, '.local/bin'),
    path.join(home, '.opencode/bin'),
    path.join(home, '.antigravity/antigravity/bin'),
    path.join(home, '.claude/local'),
    path.join(home, '.local/share/mise/shims'),
    path.join(home, '.volta/bin'),
    path.join(home, '.bun/bin'),
    path.join(home, '.npm-global/bin'),
    path.join(home, '.asdf/shims'),
  ];
  const mac =
    platform === 'darwin'
      ? [
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin',
          '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS',
          '/Applications/Antigravity.app/Contents/Resources/app/bin',
          '/Applications/Antigravity.app/Contents/Resources/bin',
        ]
      : ['/usr/local/bin'];
  return [...shared, ...mac, '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/**
 * The `PATH` CLIs should see: the user's login-shell PATH (read once at host start, 2 s timeout)
 * followed by the usual install folders, so a CLI installed by a shell profile or desktop app is
 * found even when the app was started from the Dock.
 */
export async function resolvePluginPath(source: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string> {
  const home = source.HOME ?? homedir();
  const fallbacks = fallbackPluginDirs(platform, home, source);
  const login = platform === 'win32' ? '' : await loginShellPath(source.SHELL ?? '/bin/sh');
  const dirs = [...login.split(path.delimiter), ...(source.PATH ?? '').split(path.delimiter), ...fallbacks];
  return [...new Set(dirs.filter((dir) => dir !== ''))].join(path.delimiter);
}

function loginShellPath(shell: string): Promise<string> {
  const marker = '__ORIKAMI_PATH__';
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-lc', `printf '${marker}%s${marker}' "$PATH"`],
      { timeout: LOGIN_SHELL_TIMEOUT_MS, env: { HOME: process.env.HOME ?? homedir(), USER: process.env.USER ?? '' } },
      (_error, stdout) => {
        const match = new RegExp(`${marker}(.*)${marker}`).exec(stdout);
        resolve(match?.[1] ?? '');
      },
    );
  });
}
