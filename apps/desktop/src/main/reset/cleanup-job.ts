import { z } from 'zod';
import type { ResetStep } from '../../renderer/bridge.ts';
import type { ResetContext } from './reset-paths.ts';

/** How to open MorrowBot again after a reset: always the binary the helper itself runs under. */
export interface Relaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** Which deleting choice the job is, and what happens after it. */
export type JobChoice = { readonly kind: 'reset'; readonly relaunch: Relaunch } | { readonly kind: 'full-uninstall' };

/** What Electron main hands the cleanup helper: the approved steps, and the context to check them against again. */
export interface CleanupJob {
  readonly choice: JobChoice;
  readonly context: ResetContext;
  /** The delete and Keychain steps the user confirmed. The helper never moves anything to the Trash. */
  readonly approved: readonly ResetStep[];
  /** Processes that must exit before anything is removed: Electron main. */
  readonly waitPids: readonly number[];
}

/** What the helper knows about itself, never taken from the job. */
export interface HelperFacts {
  readonly platform: NodeJS.Platform;
  /** The home folder with every symbolic link resolved. */
  readonly homeDir: string;
  readonly execPath: string;
}

const Absolute = z.string().min(1).max(4_096).refine((value) => value.startsWith('/'), 'must be absolute');

const Step: z.ZodType<ResetStep> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('delete'), path: Absolute }),
  z.strictObject({ kind: z.literal('trash'), path: Absolute }),
  z.strictObject({ kind: z.literal('keychain'), service: z.string().min(1).max(200), account: z.string().min(1).max(200) }),
]);

const Job: z.ZodType<CleanupJob> = z.strictObject({
  choice: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('reset'), relaunch: z.strictObject({ command: Absolute, args: z.array(z.string().max(4_096)).max(50), cwd: Absolute }) }),
    z.strictObject({ kind: z.literal('full-uninstall') }),
  ]),
  context: z.strictObject({
    platform: z.enum(['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd']),
    homeDir: Absolute,
    profile: z.strictObject({ kind: z.enum(['installed', 'isolated']), dataDir: Absolute }),
    workspaces: z.array(Absolute).max(5_000).nullable(),
  }),
  approved: z.array(Step).max(100),
  waitPids: z.array(z.number().int().positive()).min(1).max(10),
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

/** Why the helper must not run this job, or null: its platform, home and relaunch program must be the helper's own. */
export function jobRefusal(job: CleanupJob, facts: HelperFacts): string | null {
  if (job.context.platform !== facts.platform) return 'The job names another platform.';
  if (job.context.homeDir !== facts.homeDir) return 'The job names another home folder.';
  switch (job.choice.kind) {
    case 'reset':
      return job.choice.relaunch.command === facts.execPath ? null : 'The job would start another program.';
    case 'full-uninstall':
      return null;
  }
}
