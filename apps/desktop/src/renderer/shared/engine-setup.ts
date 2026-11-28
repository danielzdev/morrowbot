import { z } from 'zod';
import type {
  ExternalOpenResult,
  MorrowbotBridge,
  ProviderInstallCapabilities,
  ProviderInstallProgress,
  ProviderInstallResult,
  SignInLaunch,
} from '../bridge.ts';

/**
 * The one thing a not-ready engine asks of the user during first-run onboarding (spec §7): 1-click
 * install, download (when no CLI auto-installer exists), sign in through Terminal, copy a command,
 * recheck, or turn it back on. Updates live in Settings › Providers only, never in onboarding.
 */
export type SetupAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'install'; readonly downloadUrl: string | null }
  | { readonly kind: 'sign-in-terminal' }
  | { readonly kind: 'copy'; readonly text: string }
  | { readonly kind: 'guide'; readonly label: 'Download' | 'How to set up'; readonly url: string }
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
  readonly installing: boolean;
  readonly progress: string | null;
  /** Optional calm hint shown under the row (e.g. outdated engine updated later in Settings › Providers). */
  readonly note?: string | null;
  readonly action: SetupAction;
}

const Launch = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('opened') }), z.strictObject({ kind: z.literal('unavailable'), reason: z.string() })]);

/** Main's answer to `signInTerminal`, parsed at the boundary. */
export function parseLaunch(reply: unknown): SignInLaunch {
  const parsed = Launch.safeParse(reply);
  return parsed.success ? parsed.data : { kind: 'unavailable', reason: "Terminal didn't open. Use the command instead." };
}

const ExternalOpen = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('opened') }),
  z.strictObject({ kind: z.literal('failed'), reason: z.string() }),
]);

/** Main's answer to `openExternal`, parsed at the boundary. */
export function parseExternalOpen(reply: unknown): ExternalOpenResult {
  if (reply === undefined) return { kind: 'opened' };
  const parsed = ExternalOpen.safeParse(reply);
  return parsed.success ? parsed.data : { kind: 'failed', reason: "MorrowBot couldn't open your browser." };
}

function cleanIpcMessage(error: unknown): string {
  if (!(error instanceof Error)) return "MorrowBot couldn't open your browser.";
  const stripped = error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim();
  return stripped === '' ? "MorrowBot couldn't open your browser." : stripped;
}

/** Opens an external URL through the bridge and returns a user-facing error message, or `null` when it opened. */
export async function openExternalLink(bridge: Pick<MorrowbotBridge, 'openExternal'>, url: string): Promise<string | null> {
  try {
    const reply = parseExternalOpen(await bridge.openExternal(url));
    return reply.kind === 'opened' ? null : reply.reason;
  } catch (error) {
    return cleanIpcMessage(error);
  }
}

const Capability = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('auto'), tool: z.enum(['npm', 'brew']) }),
  z.strictObject({ kind: z.literal('download'), label: z.string(), url: z.string() }),
]);

const Capabilities = z.record(z.string(), Capability);

/** Main's answer to `providerInstallCapabilities`, parsed at the boundary. */
export function parseInstallCapabilities(reply: unknown): ProviderInstallCapabilities {
  const parsed = Capabilities.safeParse(reply);
  return parsed.success ? parsed.data : {};
}

const InstallResult = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('installed') }),
  z.strictObject({ kind: z.literal('cancelled') }),
  z.strictObject({ kind: z.literal('failed'), reason: z.string(), downloadUrl: z.string().nullable() }),
]);

/** Main's answer to `installProvider`, parsed at the boundary. */
export function parseInstallResult(reply: unknown): ProviderInstallResult {
  const parsed = InstallResult.safeParse(reply);
  return parsed.success ? parsed.data : { kind: 'failed', reason: 'MorrowBot could not complete the install.', downloadUrl: null };
}

const InstallProgress = z.strictObject({
  providerId: z.string(),
  mode: z.enum(['install', 'update']),
  phase: z.enum(['running', 'done', 'failed', 'cancelled']),
  detail: z.string(),
});

/** Live install progress event from main, parsed at the boundary. */
export function parseInstallProgress(event: unknown): ProviderInstallProgress | null {
  const parsed = InstallProgress.safeParse(event);
  return parsed.success ? parsed.data : null;
}
