import { stat } from 'node:fs/promises';
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

/** What a fence keeps programs from. Every path is absolute. */
export interface FencedFolders {
  /** The host's data folder. Programs read it, but write only inside `writable`. */
  readonly data: string;
  /** Name prefixes of the data folder's entries that programs cannot read either. */
  readonly hidden: readonly string[];
  /** Folders inside the data folder that programs may write in. */
  readonly writable: readonly string[];
  /** Folders elsewhere holding code the host runs, such as its plugins: programs read them but never write there. */
  readonly readOnly: readonly string[];
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** Where a program is looked for when `PATH` is unset, as `execvp` does. */
const DEFAULT_PATH = '/usr/bin:/bin';
/** Setuid tools, which macOS never starts inside a sandbox. They only read the process table, so they run outside it. */
const PROCESS_VIEWERS = ['/bin/ps', '/usr/bin/top'];

/**
 * A fence around the host's folders. Entries of the data folder named with a `hidden` prefix cannot be read,
 * written, linked, renamed or created. The data folder, the `readOnly` folders and every folder above them cannot be
 * renamed or removed, and the data folder and its parents cannot be cloned, so nothing moves out from under a rule.
 * Nothing inside may ask macOS to start a program outside the fence: no opening apps, files or links (`open`), no
 * Apple Events to other apps, and no other setuid tool (`sudo`, `crontab`, `at`); macOS already refuses `launchctl`
 * jobs from inside a sandbox. Only macOS has a fence.
 */
export function dataFolderFence(platform: NodeJS.Platform, folders: FencedFolders): Fence {
  if (platform !== 'darwin') return OPEN;
  if (folders.hidden.length === 0) throw new Error('A fence must hide at least one entry');
  const data = absolute(folders.data);
  const readOnly = folders.readOnly.map(absolute);
  const writable = folders.writable.map((folder) => inside(data, absolute(folder)));
  const any = (filter: string, paths: readonly string[]): string => paths.map((each) => `(${filter} ${quoted(each)})`).join(' ');
  const parents = [...new Set([data, ...readOnly].flatMap((folder) => ancestors(path.dirname(folder))))];
  return {
    kind: 'seatbelt',
    profile: [
      '(version 1)',
      '(allow default)',
      `(deny file-write* ${any('subpath', [data, ...readOnly])} ${any('literal', parents)})`,
      ...(writable.length === 0 ? [] : [`(allow file-write* ${any('subpath', writable)})`]),
      `(deny file-clone ${any('literal', ancestors(data))})`,
      `(deny file-read* file-write* ${any('prefix', folders.hidden.map((prefix) => path.join(data, prefix)))})`,
      '(deny lsopen)',
      '(deny appleevent-send)',
      `(allow process-exec ${any('literal', PROCESS_VIEWERS)} (with no-sandbox))`,
    ].join('\n'),
  };
}

export type FencedProgram =
  | { readonly kind: 'program'; readonly file: string; readonly args: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not-executable' };

/** The program to start for `command` behind `fence`, looked up on `pathValue` as the system would. */
export async function fencedProgram(fence: Fence, command: string, args: readonly string[], pathValue: string | undefined): Promise<FencedProgram> {
  switch (fence.kind) {
    case 'open':
      return { kind: 'program', file: command, args };
    case 'seatbelt': {
      const found = await statExecutable(command, pathValue ?? DEFAULT_PATH);
      if (found.kind === 'found') return { kind: 'program', file: SANDBOX_EXEC, args: ['-p', fence.profile, '--', path.resolve(found.path), ...args] };
      return command.includes('/') && (await exists(command)) ? { kind: 'not-executable' } : { kind: 'missing' };
    }
  }
}

function absolute(folder: string): string {
  if (!path.isAbsolute(folder)) throw new Error(`A fenced folder must be an absolute path: ${folder}`);
  return path.resolve(folder);
}

function inside(data: string, folder: string): string {
  const relative = path.relative(data, folder);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`A writable folder must be inside the data folder: ${folder}`);
  return folder;
}

function ancestors(folder: string): string[] {
  const parent = path.dirname(folder);
  return parent === folder ? [folder] : [folder, ...ancestors(parent)];
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** A Seatbelt string literal. */
const quoted = (text: string): string => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
