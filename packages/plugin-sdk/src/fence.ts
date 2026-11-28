import path from 'node:path';
import { z } from 'zod';
import { statExecutable } from './files.ts';

/**
 * How a plugin's programs are kept from the host's own files. `seatbelt`: each program runs under macOS
 * `sandbox-exec` with `profile`, and so does everything it starts. `open`: programs run as they are.
 */
export const Fence = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open') }),
  z.strictObject({ kind: z.literal('seatbelt'), profile: z.string().min(1) }),
]);
export type Fence = z.infer<typeof Fence>;

export const OPEN: Fence = { kind: 'open' };

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** Setuid tools, which macOS never starts inside a sandbox. They only read the process table, so they run outside it. */
const PROCESS_VIEWERS = ['/bin/ps', '/usr/bin/top'];

/**
 * Hides every entry of `folder` whose name starts with one of `prefixes`: it cannot be read, written, linked,
 * renamed or created. `folder` and every folder above it cannot be renamed or removed, so nothing moves out from
 * under the rule. Other setuid tools (`sudo`, `crontab`, `at`) cannot start at all. Only macOS has a fence.
 */
export function hiddenFilesFence(platform: NodeJS.Platform, folder: string, prefixes: readonly string[]): Fence {
  if (platform !== 'darwin') return OPEN;
  if (!path.isAbsolute(folder)) throw new Error('A fenced folder must be an absolute path');
  const any = (filter: string, paths: readonly string[]): string => paths.map((each) => `(${filter} ${quoted(each)})`).join(' ');
  return {
    kind: 'seatbelt',
    profile: [
      '(version 1)',
      '(allow default)',
      `(deny file-read* file-write* ${any('prefix', prefixes.map((prefix) => path.join(folder, prefix)))})`,
      `(deny file-write* ${any('literal', ancestors(folder))})`,
      `(allow process-exec ${any('literal', PROCESS_VIEWERS)} (with no-sandbox))`,
    ].join('\n'),
  };
}

/** The program to start for `command` behind `fence`, or null when `command` is not on `pathValue`. */
export async function fencedProgram(
  fence: Fence,
  command: string,
  args: readonly string[],
  pathValue: string,
): Promise<{ readonly file: string; readonly args: readonly string[] } | null> {
  switch (fence.kind) {
    case 'open':
      return { file: command, args };
    case 'seatbelt': {
      const found = await statExecutable(command, pathValue);
      return found.kind === 'missing' ? null : { file: SANDBOX_EXEC, args: ['-p', fence.profile, found.path, ...args] };
    }
  }
}

function ancestors(folder: string): string[] {
  const parent = path.dirname(folder);
  return parent === folder ? [folder] : [folder, ...ancestors(parent)];
}

/** A Seatbelt string literal. */
const quoted = (text: string): string => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
