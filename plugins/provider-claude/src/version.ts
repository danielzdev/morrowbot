import { checkVersion, readCliVersion } from '@morrowbot/plugin-sdk';

/** The Claude Code versions the fixtures have been run on. */
const SUPPORTED = { atLeast: '2.1.332', below: '2.2.0' } as const;
export const SUPPORTED_TEXT = `>=${SUPPORTED.atLeast} <${SUPPORTED.below}`;

export type Version =
  | { readonly kind: 'supported'; readonly version: string }
  | { readonly kind: 'above'; readonly version: string; readonly reason: string }
  | { readonly kind: 'below'; readonly version: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Where a `claude --version` answer falls against the tested range. */
export function judgeVersion(version: string): Version {
  const range = checkVersion(version, SUPPORTED);
  switch (range) {
    case 'inside':
      return { kind: 'supported', version };
    case 'below':
      return { kind: 'below', version };
    case 'above':
      return {
        kind: 'above',
        version,
        reason: `Claude ${version} isn't tested with MorrowBot yet. Update MorrowBot, or point \`cliPath\` at a Claude 2.1.x install.`,
      };
    case 'unparsable':
      return { kind: 'unreadable', reason: `Claude Code reported a version MorrowBot cannot read ("${version}").` };
  }
}

/** Runs `claude --version` (cached by the executable's path, mtime and size) and judges it. */
export async function readVersion(cliPath: string, cwd: string): Promise<Version> {
  const found = await readCliVersion(cliPath, { cwd });
  switch (found.kind) {
    case 'missing':
      return { kind: 'missing' };
    case 'failed':
      return { kind: 'unreadable', reason: found.message };
    case 'version':
      return judgeVersion(found.version);
  }
}
