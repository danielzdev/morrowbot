import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { ResetChoice, ResetOutcome, ResetPlan, ResetStep } from '../../renderer/bridge.ts';
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
  /** Stops new update checks, so none starts between the last check and quitting. */
  readonly pauseUpdates: () => void;
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
  /** After a failure with the host already stopped: tell the user and restart MorrowBot. */
  readonly recover: (message: string) => void;
}

export interface ResetFlow {
  plan(): Promise<ResetPlan>;
  run(choice: ResetChoice, token: string): Promise<ResetOutcome>;
}

const refused = (reason: string): ResetOutcome => ({ kind: 'refused', reason });

/**
 * Settings › About › Reset or Uninstall, in main. `plan` resolves every choice and remembers that
 * exact list under a new token; `run` pauses update checks, then acts only on a choice from the latest
 * list, and only when resolving it again gives the same steps. It stops the host, starts the cleanup helper for any
 * deletion (it runs after main exits), moves the app to the Trash itself, then quits.
 */
export function resetFlow(deps: ResetDeps): ResetFlow {
  let shown: ResetPlan | null = null;
  let busy = false;

  const optionsNow = async () => {
    const context = await deps.context();
    return { context, options: await resetOptionsOf(context, deps.bundle(), deps.keychain) };
  };

  /** Moves the app to the Trash after checking the bundle on disk once more, with Open at Login off; restores it on failure. */
  async function uninstall(trash: readonly string[], context: ResetContext): Promise<void> {
    const wasOn = deps.loginItem.isOn();
    if (wasOn) deps.loginItem.set(false);
    try {
      for (const target of trash) {
        const bundle = await bundlePlanOf(context, deps.bundle());
        if (bundle.kind === 'refused') throw new Error(bundle.reason);
        if (bundle.path !== target) throw new Error('MorrowBot.app moved since the list was made.');
        await deps.trash(target);
      }
    } catch (error) {
      if (wasOn) deps.loginItem.set(true);
      throw error;
    }
  }

  async function act(choice: ResetChoice, steps: readonly ResetStep[], context: ResetContext): Promise<void> {
    const trash = steps.flatMap((step) => (step.kind === 'trash' ? [step.path] : []));
    const approved = steps.filter((step) => step.kind !== 'trash');
    const job = (jobChoice: CleanupJob['choice']): CleanupJob => ({ choice: jobChoice, context, approved, waitPids: [deps.mainPid] });
    switch (choice) {
      case 'reset':
        await (await deps.startHelper(job({ kind: 'reset', relaunch: deps.relaunch }))).release();
        return;
      case 'uninstall-app':
        await uninstall(trash, context);
        return;
      case 'full-uninstall': {
        const helper = await deps.startHelper(job({ kind: 'full-uninstall' }));
        try {
          await uninstall(trash, context);
        } catch (error) {
          helper.cancel();
          throw error;
        }
        await helper.release();
        return;
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
      try {
        deps.pauseUpdates();
        const { context, options } = await optionsNow();
        const now = options.find((option) => option.choice === choice);
        if (now === undefined || !isDeepStrictEqual(before, now)) {
          shown = null;
          busy = false;
          return refused('Something changed since this list was made. Review it again.');
        }
        if (now.kind === 'unavailable') {
          busy = false;
          return refused(now.reason);
        }
        await deps.stopHost();
        try {
          await act(choice, now.steps, context);
        } catch (error) {
          deps.recover(error instanceof Error ? error.message : String(error));
          return refused('MorrowBot could not finish, so it is restarting with everything as it was.');
        }
        deps.quit();
        return { kind: 'quitting' };
      } catch (error) {
        busy = false;
        throw error;
      }
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
