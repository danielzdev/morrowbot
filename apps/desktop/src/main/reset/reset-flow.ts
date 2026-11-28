import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { ResetChoice, ResetOption, ResetOutcome, ResetPlan, ResetStep } from '../../renderer/bridge.ts';
import { checkSender, IpcRefusedError } from '../ipc-proxy.ts';
import type { FromRenderer } from '../shell-actions.ts';
import type { CleanupJob, Relaunch } from './cleanup-job.ts';
import type { Keychain } from './keychain.ts';
import type { ResetContext } from './reset-paths.ts';
import { bundlePlanOf, resetOptionsOf, type BundleInput } from './reset-plan.ts';

/** A started cleanup helper, loaded and waiting for main to exit. */
export interface HelperHandle {
  /** Writes the reset lock and tells it to go ahead once main exits. */
  release(): Promise<void>;
  /** Stops it before it touches anything. */
  cancel(): void;
}

/** What the reset flow needs from Electron main. */
export interface ResetDeps {
  /** The context right now, with the agents' workspaces the host reports. */
  readonly context: () => Promise<ResetContext>;
  /** Where the app runs from, and whether an update is pending, right now. */
  readonly bundle: () => BundleInput;
  readonly keychain: Keychain;
  /** Holds update checks, timed or asked for, while a run decides; resumed when it is refused. */
  readonly updates: { readonly pause: () => void; readonly resume: () => void };
  /** Open at Login, which uninstalling turns off so macOS does not keep a login item for a trashed app. */
  readonly loginItem: { readonly isOn: () => boolean; readonly set: (on: boolean) => void };
  /** False once MorrowBot has begun quitting or restarting. */
  readonly running: () => boolean;
  readonly stopHost: () => Promise<void>;
  readonly startHelper: (job: CleanupJob) => Promise<HelperHandle>;
  readonly trash: (target: string) => Promise<void>;
  /** How to open MorrowBot again after a reset. */
  readonly relaunch: Relaunch;
  readonly mainPid: number;
  readonly quit: () => void;
  /** After a failure with the host already stopped: tell the user, then restart MorrowBot (or just quit once the app is in the Trash). */
  readonly recover: (message: string, restart: boolean) => void;
}

export interface ResetFlow {
  plan(): Promise<ResetPlan>;
  run(choice: ResetChoice, token: string): Promise<ResetOutcome>;
}

const refused = (reason: string): ResetOutcome => ({ kind: 'refused', reason });

/**
 * Settings › About › Reset or Uninstall, in main. `plan` resolves every choice and remembers that
 * exact list under a new token; `run` holds update checks, then acts only on a choice from the latest
 * list, and only when resolving it again gives the same steps; a refusal resumes them. It stops the host, starts the cleanup helper for any
 * deletion (it runs after main exits), moves the app to the Trash itself, then quits.
 */
export function resetFlow(deps: ResetDeps): ResetFlow {
  let shown: ResetPlan | null = null;
  let busy = false;

  const optionsNow = async () => {
    const context = await deps.context();
    return { context, options: await resetOptionsOf(context, deps.bundle(), deps.keychain) };
  };

  /** Checks the bundle on disk once more, turns Open at Login off, and moves the app to the Trash; turns it back on if that fails. */
  async function uninstall(trash: readonly string[], context: ResetContext): Promise<void> {
    for (const target of trash) {
      const bundle = await bundlePlanOf(context, deps.bundle());
      if (bundle.kind === 'refused') throw new Error(bundle.reason);
      if (bundle.path !== target) throw new Error('MorrowBot.app moved since the list was made.');
    }
    const wasOn = deps.loginItem.isOn();
    if (wasOn) deps.loginItem.set(false);
    try {
      for (const target of trash) await deps.trash(target);
    } catch (error) {
      if (wasOn) deps.loginItem.set(true);
      throw error;
    }
  }

  /** Runs a confirmed choice. `data-kept`: the app is already in the Trash but the helper could not be told to go ahead. */
  async function act(choice: ResetChoice, steps: readonly ResetStep[], context: ResetContext): Promise<{ readonly kind: 'done' } | { readonly kind: 'data-kept'; readonly reason: string }> {
    const trash = steps.flatMap((step) => (step.kind === 'trash' ? [step.path] : []));
    const approved = steps.filter((step) => step.kind !== 'trash');
    const job = (jobChoice: CleanupJob['choice']): CleanupJob => ({ choice: jobChoice, context, approved, waitPids: [deps.mainPid] });
    switch (choice) {
      case 'reset':
        await (await deps.startHelper(job({ kind: 'reset', relaunch: deps.relaunch }))).release();
        return { kind: 'done' };
      case 'uninstall-app':
        await uninstall(trash, context);
        return { kind: 'done' };
      case 'full-uninstall': {
        const helper = await deps.startHelper(job({ kind: 'full-uninstall' }));
        try {
          await uninstall(trash, context);
        } catch (error) {
          helper.cancel();
          throw error;
        }
        try {
          await helper.release();
        } catch (error) {
          return { kind: 'data-kept', reason: error instanceof Error ? error.message : String(error) };
        }
        return { kind: 'done' };
      }
    }
  }

  return {
    plan: async () => {
      const { options } = await optionsNow();
      shown = { token: randomUUID(), options };
      return shown;
    },
    run: async (choice, token) => {
      if (busy || !deps.running()) return refused('MorrowBot is already quitting.');
      if (shown === null || shown.token !== token) return refused('This list is out of date. Review it again.');
      const before = shown.options.find((option) => option.choice === choice);
      busy = true;
      deps.updates.pause();
      const handBack = (): void => {
        busy = false;
        deps.updates.resume();
      };
      const giveBack = (outcome: ResetOutcome): ResetOutcome => {
        handBack();
        return outcome;
      };
      let now: ResetOption | undefined;
      let context: ResetContext;
      try {
        const fresh = await optionsNow();
        context = fresh.context;
        now = fresh.options.find((option) => option.choice === choice);
      } catch (error) {
        handBack();
        throw error;
      }
      if (now === undefined || !isDeepStrictEqual(before, now)) {
        shown = null;
        return giveBack(refused('Something changed since this list was made. Review it again.'));
      }
      if (now.kind === 'unavailable') return giveBack(refused(now.reason));
      await deps.stopHost();
      try {
        const result = await act(choice, now.steps, context);
        if (result.kind === 'data-kept') {
          deps.recover(`MorrowBot.app is in the Trash, but its data could not be removed: ${result.reason}`, false);
          return refused('MorrowBot.app is in the Trash, but its data was not removed. MorrowBot is quitting.');
        }
      } catch (error) {
        deps.recover(error instanceof Error ? error.message : String(error), true);
        return refused('MorrowBot could not finish, so it is restarting with everything as it was.');
      }
      deps.quit();
      return { kind: 'quitting' };
    },
  };
}

const RunRequest = z.strictObject({ choice: z.enum(['reset', 'uninstall-app', 'full-uninstall']), token: z.string().min(1).max(100) });

/** Checks an IPC `run-reset` message: a choice and the plan token it came from. */
export function parseResetRequest(options: FromRenderer): { readonly choice: ResetChoice; readonly token: string } {
  checkSender(options.sender, options.rendererUrl);
  const parsed = RunRequest.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed reset request');
  return parsed.data;
}
