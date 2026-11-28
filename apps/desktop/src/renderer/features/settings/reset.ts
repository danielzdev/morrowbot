import { z } from 'zod';
import type { MorrowbotBridge, ResetChoice, ResetOption, ResetOutcome as ResetOutcomeValue, ResetPlan as ResetPlanValue, ResetStep } from '../../bridge.ts';

const Path = z.string().min(1).max(4_096);
const Choice = z.enum(['reset', 'uninstall-app', 'full-uninstall']);

const Step: z.ZodType<ResetStep> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('delete'), path: Path }),
  z.strictObject({ kind: z.literal('trash'), path: Path }),
  z.strictObject({ kind: z.literal('keychain'), service: z.string().min(1).max(200) }),
]);

const Option: z.ZodType<ResetOption> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('available'), choice: Choice, steps: z.array(Step).max(100), kept: z.array(z.strictObject({ path: Path, reason: z.string().max(500) })).max(200) }),
  z.strictObject({ kind: z.literal('unavailable'), choice: Choice, reason: z.string().max(500) }),
]);

/** `bridge.resetPlan()`, parsed at the IPC boundary. */
export const ResetPlan: z.ZodType<ResetPlanValue> = z.strictObject({ token: z.string().min(1).max(100), options: z.array(Option).max(3) });

/** `bridge.runReset()`, parsed at the IPC boundary. */
export const ResetOutcome: z.ZodType<ResetOutcomeValue> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('quitting') }),
  z.strictObject({ kind: z.literal('refused'), reason: z.string().max(500) }),
]);

export type ResetBridge = Pick<MorrowbotBridge, 'resetPlan' | 'runReset'>;

/** The plan main resolved just now, or null when it could not be read. */
export async function loadResetPlan(bridge: ResetBridge): Promise<ResetPlanValue | null> {
  try {
    const parsed = ResetPlan.safeParse(await bridge.resetPlan());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Runs a reviewed choice; anything main did not answer with is a refusal. */
export async function runReset(bridge: ResetBridge, choice: ResetChoice, token: string): Promise<ResetOutcomeValue> {
  try {
    const parsed = ResetOutcome.safeParse(await bridge.runReset({ choice, token }));
    return parsed.success ? parsed.data : { kind: 'refused', reason: 'MorrowBot sent an answer it could not read. Nothing was changed.' };
  } catch {
    return { kind: 'refused', reason: 'MorrowBot could not start this. Nothing was changed.' };
  }
}

export interface ChoiceCopy {
  readonly title: string;
  readonly summary: string;
  readonly confirm: string;
  readonly understand: string;
}

export const CHOICE_ORDER: readonly ResetChoice[] = ['reset', 'uninstall-app', 'full-uninstall'];

export const CHOICE_COPY: Readonly<Record<ResetChoice, ChoiceCopy>> = {
  reset: {
    title: 'Reset & start fresh',
    summary: "Deletes MorrowBot's chats, settings, plugins and caches, then reopens it like new. The app stays installed.",
    confirm: 'Reset & relaunch',
    understand: 'I understand the deleted items cannot be recovered.',
  },
  'uninstall-app': {
    title: 'Uninstall app (keep data)',
    summary: 'Moves MorrowBot.app to the Trash and quits. Your data stays for a future reinstall.',
    confirm: 'Move to Trash & quit',
    understand: 'I understand MorrowBot quits and moves to the Trash.',
  },
  'full-uninstall': {
    title: 'Full uninstall (app + all data)',
    summary: "Moves MorrowBot.app to the Trash, quits, then deletes all of MorrowBot's data, caches and Keychain items.",
    confirm: 'Uninstall everything',
    understand: 'I understand the deleted items cannot be recovered.',
  },
};

/** The steps of a choice, grouped the way the confirmation lists them. */
export function groupSteps(steps: readonly ResetStep[]): { readonly trash: readonly string[]; readonly deleted: readonly string[]; readonly keychain: readonly string[] } {
  return {
    trash: steps.flatMap((step) => (step.kind === 'trash' ? [step.path] : [])),
    deleted: steps.flatMap((step) => (step.kind === 'delete' ? [step.path] : [])),
    keychain: steps.flatMap((step) => (step.kind === 'keychain' ? [step.service] : [])),
  };
}
