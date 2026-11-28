import { z } from 'zod';
import type { ResetStep } from '../../renderer/bridge.ts';
import type { ResetContext } from './reset-paths.ts';

/** A program to start once cleanup is done: MorrowBot again, after a reset. */
export interface Relaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** What Electron main hands the cleanup helper: the approved steps, and the context to check them against again. */
export interface CleanupJob {
  readonly context: ResetContext;
  /** The delete and Keychain steps the user confirmed. The helper never moves anything to the Trash. */
  readonly approved: readonly ResetStep[];
  /** Processes that must exit before anything is removed: Electron main. */
  readonly waitPids: readonly number[];
  readonly relaunch: Relaunch | null;
}

const Absolute = z.string().min(1).max(4_096).refine((value) => value.startsWith('/'), 'must be absolute');

const Step: z.ZodType<ResetStep> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('delete'), path: Absolute }),
  z.strictObject({ kind: z.literal('trash'), path: Absolute }),
  z.strictObject({ kind: z.literal('keychain'), service: z.string().min(1).max(200) }),
]);

const Job: z.ZodType<CleanupJob> = z.strictObject({
  context: z.strictObject({
    platform: z.enum(['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd']),
    homeDir: Absolute,
    profile: z.strictObject({ kind: z.enum(['installed', 'isolated']), dataDir: Absolute }),
    workspaces: z.array(Absolute).nullable(),
  }),
  approved: z.array(Step).max(100),
  waitPids: z.array(z.number().int().positive()).max(10),
  relaunch: z.strictObject({ command: Absolute, args: z.array(z.string().max(4_096)).max(50), cwd: Absolute }).nullable(),
});

/** Reads the job from the helper's command line, or null when it is not one. */
export function parseCleanupJob(text: string | undefined): CleanupJob | null {
  if (text === undefined) return null;
  try {
    const parsed = Job.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
