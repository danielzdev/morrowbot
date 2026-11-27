import type { CommandRunner } from './command.ts';
import type { Executable } from './files.ts';

/** A tested CLI version range: at least `atLeast`, and below `below`. */
export interface VersionRange {
  readonly atLeast: string;
  readonly below: string;
}

export type RangeCheck = 'below' | 'inside' | 'above' | 'unparsable';

/** Where `version` (MAJOR.MINOR.PATCH, anything after it ignored) falls against `range`. */
export function checkVersion(version: string, range: VersionRange): RangeCheck {
  const found = parse(version);
  const low = parse(range.atLeast);
  const high = parse(range.below);
  if (found === undefined || low === undefined || high === undefined) return 'unparsable';
  if (compare(found, low) < 0) return 'below';
  if (compare(found, high) >= 0) return 'above';
  return 'inside';
}

export type CliVersion =
  | { readonly kind: 'version'; readonly version: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly message: string };

const VERSION_TIMEOUT_MS = 10_000;
export interface VersionTools {
  readonly stat: (command: string) => Promise<Executable>;
  readonly run: CommandRunner['run'];
  /** One plugin's versions, keyed by the exact executable file; a restarted plugin starts empty. */
  readonly cache: Map<string, string>;
}

/**
 * Runs `<command> --version` (a probe, bounded to 10 s) and returns the first MAJOR.MINOR.PATCH in
 * its output. Cached by the executable's path, mtime and size, so an update is seen at once.
 */
export async function readCliVersion(tools: VersionTools, command: string, options: { readonly cwd: string }): Promise<CliVersion> {
  const executable = await tools.stat(command);
  if (executable.kind === 'missing') return { kind: 'missing' };
  const key = `${executable.path}\0${String(executable.mtimeMs)}\0${String(executable.size)}`;
  const cached = tools.cache.get(key);
  if (cached !== undefined) return { kind: 'version', version: cached };
  let output = '';
  const signal = AbortSignal.timeout(VERSION_TIMEOUT_MS);
  const exit = await tools.run(executable.path, {
    args: ['--version'],
    cwd: options.cwd,
    input: '',
    files: [],
    scope: { kind: 'probe' },
    signal,
    onLine: (line) => {
      output += `${line}\n`;
    },
  });
  if (signal.aborted) return { kind: 'failed', message: `"${command} --version" did not answer within 10 seconds` };
  switch (exit.kind) {
    case 'not-found':
      return { kind: 'missing' };
    case 'failed':
      return { kind: 'failed', message: exit.message };
    case 'exited':
      break;
  }
  const version = /\d+\.\d+\.\d+/.exec(output)?.[0];
  if (version === undefined) return { kind: 'failed', message: `"${command} --version" printed no version` };
  tools.cache.set(key, version);
  return { kind: 'version', version };
}

function parse(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
