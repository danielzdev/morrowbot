import { z } from 'zod';
import type { SignInLaunch } from '../bridge.ts';

/**
 * The one thing a not-ready engine asks of the user (spec §7): sign in through Terminal, copy a
 * command, read the setup guide, recheck, or turn it back on. `none` while it is ready or busy.
 */
export type SetupAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'sign-in-terminal' }
  | { readonly kind: 'copy'; readonly text: string }
  | { readonly kind: 'guide'; readonly label: 'How to install' | 'How to update' | 'How to set up'; readonly url: string }
  | { readonly kind: 'recheck' }
  | { readonly kind: 'turn-on' };

export type EngineTone = 'ok' | 'muted' | 'warning' | 'error';

/** One built-in engine in the first-run checklist. Text is already privacy-safe. */
export interface EngineRow {
  readonly id: string;
  readonly name: string;
  readonly tone: EngineTone;
  readonly status: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly action: SetupAction;
}

const Launch = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('opened') }), z.strictObject({ kind: z.literal('unavailable'), reason: z.string() })]);

/** Main's answer to `signInTerminal`, parsed at the boundary. */
export function parseLaunch(reply: unknown): SignInLaunch {
  const parsed = Launch.safeParse(reply);
  return parsed.success ? parsed.data : { kind: 'unavailable', reason: "Terminal didn't open. Use the command instead." };
}
