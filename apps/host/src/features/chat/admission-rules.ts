import type { Message, ProviderInfo, SessionChoice, SessionChoiceReason, TurnMode } from '@morrowbot/contracts';
import type { SessionRecord } from './ports.ts';
import type { BoundProvider, SessionPlan } from './turn.ts';

/** Why the plugin's info refuses this binding, or undefined when its profile is advertised. */
export function profileAllowed(info: ProviderInfo, binding: BoundProvider, mode: TurnMode): string | undefined {
  switch (info.kind) {
    case 'missing-runtime':
      return `The provider's CLI is not installed. ${info.install}`;
    case 'outdated':
      return `The provider's CLI ${info.found} is too old (supported: ${info.supported}).`;
    case 'signed-out':
      return `The provider is signed out. Run "${info.signIn.argv.join(' ')}" in a terminal, then Recheck.`;
    case 'error':
      return `The provider could not be checked: ${info.message}`;
    case 'ready':
    case 'ready-models-later':
      break;
  }
  const { profiles, withheld } = info.capabilities;
  const matches = profiles.some(
    (profile) => profile.access === binding.access && profile.vendorSettings === binding.vendorSettings && profile.modes.includes(mode),
  );
  if (matches) return undefined;
  const reason = withheld.find((entry) => entry.access === binding.access && entry.vendorSettings === binding.vendorSettings)?.reason;
  if (reason !== undefined) return reason;
  return profiles.length === 0
    ? 'This provider offers no access level right now.'
    : `This provider does not offer ${binding.access} access with ${binding.vendorSettings} settings.`;
}

export type SessionDecision =
  | { readonly kind: 'plan'; readonly plan: SessionPlan }
  | { readonly kind: 'choice-required'; readonly reason: SessionChoiceReason };

export interface SessionInputs {
  /** False for a stateless plugin (`capabilities.sessions: false`). */
  readonly sessions: boolean;
  readonly accountKey: string;
  /** The row for this (plugin, account, route, cwd, thread), if any. */
  readonly row: SessionRecord | undefined;
  readonly systemHash: string;
  readonly vendorSettings: BoundProvider['vendorSettings'];
  /** Messages before the source input. */
  readonly history: readonly Message[];
  readonly choice: SessionChoice;
}

/**
 * Picks the vendor session for a send or Continue. Stateless plugins and unknown accounts ('')
 * always get a stateless turn. A diverged session is never resumed under `auto`; a session whose
 * instructions changed is never resumed at all; history without an eligible session needs a seed.
 */
export function decideSession(input: SessionInputs): SessionDecision {
  if (!input.sessions || input.accountKey === '') return { kind: 'plan', plan: { kind: 'stateless' } };
  const { row } = input;
  const eligible = row !== undefined && row.state !== 'needs-seed' ? row : undefined;
  const sameInstructions = eligible !== undefined && eligible.systemHash === input.systemHash && eligible.vendorSettings === input.vendorSettings;
  const resume = (record: SessionRecord): SessionDecision => ({
    kind: 'plan',
    plan: { kind: 'resume', rowId: record.id, ref: record.ref, priorState: record.state },
  });
  const unseeded: SessionDecision =
    input.history.length > 0 ? { kind: 'choice-required', reason: 'unseeded-history' } : { kind: 'plan', plan: { kind: 'fresh', seeded: false } };
  switch (input.choice.kind) {
    case 'new-seeded':
      return { kind: 'plan', plan: { kind: 'fresh', seeded: true } };
    case 'continue-existing':
      if (eligible === undefined) return unseeded;
      return sameInstructions ? resume(eligible) : { kind: 'choice-required', reason: 'instructions-changed' };
    case 'auto':
      if (eligible === undefined) return unseeded;
      if (!sameInstructions) return { kind: 'choice-required', reason: 'instructions-changed' };
      if (eligible.state === 'diverged') return { kind: 'choice-required', reason: 'diverged' };
      return resume(eligible);
  }
}
