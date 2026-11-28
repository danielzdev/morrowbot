import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProviderInstallCapabilities, ProviderInstallCapability, ProviderInstallMode } from '../renderer/bridge.ts';

export const BUILTIN_PROVIDER_IDS = ['provider-claude', 'provider-openai', 'provider-antigravity', 'provider-opencode'] as const;
export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

export interface InstallTools {
  readonly npm: string | null;
  readonly brew: string | null;
}

export type ProviderInstallPlan =
  | {
      readonly kind: 'run';
      readonly tool: 'npm' | 'brew';
      readonly command: string;
      readonly args: readonly string[];
      readonly label: string;
      readonly downloadUrl: string;
    }
  | {
      readonly kind: 'download';
      readonly label: 'Download';
      readonly url: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'unsupported';
      readonly reason: string;
      readonly downloadUrl: string | null;
    };

export function isBuiltinProviderId(id: string): id is BuiltinProviderId {
  return BUILTIN_PROVIDER_IDS.some((each) => each === id);
}

/** Strictly allowlisted install/update plan per built-in provider. Never builds shell strings; never allows community plugins. */
export function planProviderInstall(
  providerId: string,
  mode: ProviderInstallMode,
  platform: NodeJS.Platform,
  tools: InstallTools,
): ProviderInstallPlan {
  if (!isBuiltinProviderId(providerId)) {
    return { kind: 'unsupported', reason: 'Only built-in providers support 1-click install.', downloadUrl: null };
  }
  const brewVerb = mode === 'update' ? 'upgrade' : 'install';
  switch (providerId) {
    case 'provider-claude': {
      const downloadUrl = 'https://docs.claude.com/claude-code';
      if (tools.npm !== null) {
        return { kind: 'run', tool: 'npm', command: tools.npm, args: ['install', '-g', '@anthropic-ai/claude-code@latest'], label: 'npm (@anthropic-ai/claude-code)', downloadUrl };
      }
      if (platform === 'darwin' && tools.brew !== null) {
        return { kind: 'run', tool: 'brew', command: tools.brew, args: [brewVerb, '--cask', 'claude-code'], label: 'Homebrew (claude-code)', downloadUrl };
      }
      return { kind: 'download', label: 'Download', url: downloadUrl, reason: 'Node.js (npm) or Homebrew is needed for 1-click install.' };
    }
    case 'provider-openai': {
      const downloadUrl = 'https://developers.openai.com/codex/cli';
      if (tools.npm !== null) {
        return { kind: 'run', tool: 'npm', command: tools.npm, args: ['install', '-g', '@openai/codex@latest'], label: 'npm (@openai/codex)', downloadUrl };
      }
      if (platform === 'darwin' && tools.brew !== null) {
        return { kind: 'run', tool: 'brew', command: tools.brew, args: [brewVerb, '--cask', 'codex'], label: 'Homebrew (codex)', downloadUrl };
      }
      return { kind: 'download', label: 'Download', url: downloadUrl, reason: 'Node.js (npm) or Homebrew is needed for 1-click install.' };
    }
    case 'provider-opencode': {
      const downloadUrl = 'https://opencode.ai';
      if (platform === 'darwin' && tools.brew !== null) {
        return { kind: 'run', tool: 'brew', command: tools.brew, args: [brewVerb, 'opencode'], label: 'Homebrew (opencode)', downloadUrl };
      }
      if (tools.npm !== null) {
        return { kind: 'run', tool: 'npm', command: tools.npm, args: ['install', '-g', '@opencode/cli@latest'], label: 'npm (@opencode/cli)', downloadUrl };
      }
      return { kind: 'download', label: 'Download', url: downloadUrl, reason: 'Homebrew or Node.js (npm) is needed for 1-click install.' };
    }
    case 'provider-antigravity': {
      const downloadUrl = 'https://antigravity.google/product/antigravity-cli';
      if (platform === 'darwin' && tools.brew !== null) {
        return { kind: 'run', tool: 'brew', command: tools.brew, args: [brewVerb, '--cask', 'antigravity-cli'], label: 'Homebrew (antigravity-cli)', downloadUrl };
      }
      return { kind: 'download', label: 'Download', url: downloadUrl, reason: '1-click install for Antigravity CLI uses Homebrew on macOS. Download it from antigravity.google instead.' };
    }
  }
}

/** Capabilities map exposed to the renderer so it can show Install/Update vs Download cleanly. */
export function capabilitiesOf(platform: NodeJS.Platform, tools: InstallTools): ProviderInstallCapabilities {
  const entries: [string, ProviderInstallCapability][] = [];
  for (const id of BUILTIN_PROVIDER_IDS) {
    const plan = planProviderInstall(id, 'install', platform, tools);
    switch (plan.kind) {
      case 'run':
        entries.push([id, { kind: 'auto', tool: plan.tool }]);
        break;
      case 'download':
        entries.push([id, { kind: 'download', label: plan.label, url: plan.url }]);
        break;
      case 'unsupported':
        break;
    }
  }
  return Object.fromEntries(entries);
}

/** Standard package-manager search paths so a Dock-launched packaged app still finds npm and brew. */
export function installerSearchPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? homedir();
  const extra =
    platform === 'win32'
      ? [path.join(env.APPDATA ?? '', 'npm'), path.join(home, '.local', 'bin')]
      : [
          path.join(home, '.local/bin'),
          path.join(home, '.local/share/mise/shims'),
          path.join(home, '.volta/bin'),
          path.join(home, '.asdf/shims'),
          path.join(home, '.bun/bin'),
          ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin',
        ];
  const dirs = [...(env.PATH ?? '').split(path.delimiter), ...extra].filter((dir) => dir !== '');
  return [...new Set(dirs)].join(path.delimiter);
}

async function findExecutable(name: string, pathValue: string): Promise<string | null> {
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === '') continue;
    const candidate = path.join(dir, name);
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export async function detectInstallTools(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): Promise<InstallTools> {
  const searchPath = installerSearchPath(platform, env);
  const [npm, brew] = await Promise.all([
    findExecutable(platform === 'win32' ? 'npm.cmd' : 'npm', searchPath),
    platform === 'win32' ? Promise.resolve(null) : findExecutable('brew', searchPath),
  ]);
  return { npm, brew };
}
