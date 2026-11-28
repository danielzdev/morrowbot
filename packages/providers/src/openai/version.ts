import { checkVersion, type PluginRuntime } from '@morrowbot/plugin-sdk';

/** The Codex versions the fixtures have run on, and whose experimental schema `schema/pinned.json` holds. */
export const SUPPORTED = { atLeast: '0.171.0', below: '0.172.0' } as const;
export const SUPPORTED_TEXT = `>=${SUPPORTED.atLeast} <${SUPPORTED.below}`;

export type Version =
  | { readonly kind: 'supported'; readonly version: string }
  | { readonly kind: 'above'; readonly version: string; readonly reason: string }
  | { readonly kind: 'below'; readonly version: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Where a `codex --version` answer falls against the tested range. */
export function judgeVersion(version: string): Version {
  switch (checkVersion(version, SUPPORTED)) {
    case 'inside':
      return { kind: 'supported', version };
    case 'below':
      return { kind: 'below', version };
    case 'above':
      return {
        kind: 'above',
        version,
        reason: `Codex ${version} isn't tested with Ori Kami yet. Update Ori Kami, or point "Codex CLI path" at a Codex 0.171.x install.`,
      };
    case 'unparsable':
      return { kind: 'unreadable', reason: `Codex reported a version Ori Kami cannot read ("${version}").` };
  }
}

/** Runs `codex --version` (cached by the executable's path, mtime and size) and judges it. */
export async function readVersion(runtime: PluginRuntime, cliPath: string, cwd: string): Promise<Version> {
  const found = await runtime.readCliVersion(cliPath, { cwd });
  switch (found.kind) {
    case 'missing':
      return { kind: 'missing' };
    case 'failed':
      return { kind: 'unreadable', reason: found.message };
    case 'version':
      return judgeVersion(found.version);
  }
}
