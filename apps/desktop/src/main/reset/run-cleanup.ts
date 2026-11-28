import { rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { ResetStep } from '../../renderer/bridge.ts';
import type { CleanupJob } from './cleanup-job.ts';
import type { Keychain } from './keychain.ts';
import { dataPlanOf, deleteRefusalNow } from './reset-plan.ts';

export interface CleanupDeps {
  readonly keychain: Keychain;
  readonly isAlive: (pid: number) => boolean;
  readonly sleep: (ms: number) => Promise<void>;
}

/** What the helper did. `timed-out` and `refused` touched nothing. */
export type CleanupReport =
  | { readonly kind: 'timed-out'; readonly pids: readonly number[] }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'done'; readonly done: readonly ResetStep[]; readonly skipped: readonly ResetStep[]; readonly failed: readonly { readonly step: ResetStep; readonly error: string }[] };

const POLL_MS = 200;
const WAIT_MS = 60_000;
/** After main exits, its GPU and renderer processes close their files. */
const SETTLE_MS = 1_000;

/** Polls for up to a minute until every pid has exited; answers the ones still running. */
async function waitForExit(pids: readonly number[], deps: CleanupDeps): Promise<readonly number[]> {
  for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
    const alive = pids.filter(deps.isAlive);
    if (alive.length === 0) return [];
    await deps.sleep(POLL_MS);
  }
  return pids.filter(deps.isAlive);
}

/**
 * Runs a confirmed cleanup once MorrowBot has exited. It plans the data side again from the job's
 * context and runs only the confirmed steps that the fresh plan still holds, and checks each path on
 * disk once more just before deleting it, so a path that became a symbolic link, or moved under an
 * agent workspace, since the user confirmed is skipped. Trash steps are Electron main's; the helper skips them.
 */
export async function runCleanup(job: CleanupJob, deps: CleanupDeps): Promise<CleanupReport> {
  const alive = await waitForExit(job.waitPids, deps);
  if (alive.length > 0) return { kind: 'timed-out', pids: alive };
  await deps.sleep(SETTLE_MS);
  const fresh = await dataPlanOf(job.context, job.choice.kind, deps.keychain);
  if (fresh.kind === 'refused') return { kind: 'refused', reason: fresh.reason };
  const done: ResetStep[] = [];
  const skipped: ResetStep[] = [];
  const failed: { step: ResetStep; error: string }[] = [];
  for (const step of job.approved) {
    if (step.kind === 'trash' || !fresh.steps.some((planned) => isDeepStrictEqual(planned, step))) {
      skipped.push(step);
      continue;
    }
    try {
      switch (step.kind) {
        case 'delete':
          if ((await deleteRefusalNow(job.context, step.path)) !== null) {
            skipped.push(step);
            continue;
          }
          await rm(step.path, { recursive: true, force: true });
          break;
        case 'keychain':
          await deps.keychain.remove({ service: step.service, account: step.account });
          break;
      }
      done.push(step);
    } catch (error) {
      failed.push({ step, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { kind: 'done', done, skipped, failed };
}
