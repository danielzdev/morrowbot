import type { AccessLevel, AccessProfile, ModelSelection, ProviderBinding, ProviderInfo, ProviderModel, VendorSettings } from '@morrowbot/contracts';
import { withheldReason } from './access-copy.ts';
import { interactiveProfiles, readinessOf, readyInfo, statusLine, type ProviderChoice } from './selection.ts';

/** The saved model against what the provider lists (spec §4.6 rules 2, 4 and 7). */
export type CurrentModel =
  /** `{kind:'default'}`: the provider chooses. */
  | { readonly kind: 'auto' }
  | { readonly kind: 'pinned'; readonly model: ProviderModel; readonly choices: Readonly<Record<string, string>> }
  /** A non-empty list no longer has it: sending is blocked until another model is picked. */
  | { readonly kind: 'unavailable'; readonly id: string }
  /** The list is empty or not reported yet, so it is kept and the host checks the send. */
  | { readonly kind: 'unreported'; readonly id: string };

export type ModelState =
  | { readonly kind: 'not-ready' }
  | {
      readonly kind: 'listed';
      readonly models: readonly ProviderModel[];
      /** `ready-models-later`: the provider reports models only after a first turn. */
      readonly waiting: boolean;
      readonly current: CurrentModel;
    };

export function modelState(info: ProviderInfo | undefined, selection: ModelSelection): ModelState {
  const ready = readyInfo(info);
  if (ready === null) return { kind: 'not-ready' };
  const models = ready.kind === 'ready' ? ready.models : [];
  const waiting = ready.kind === 'ready-models-later';
  if (selection.kind === 'default') return { kind: 'listed', models, waiting, current: { kind: 'auto' } };
  const model = models.find(({ id }) => id === selection.id);
  if (model === undefined) {
    const current: CurrentModel = models.length > 0 ? { kind: 'unavailable', id: selection.id } : { kind: 'unreported', id: selection.id };
    return { kind: 'listed', models, waiting, current };
  }
  const choices = Object.fromEntries(model.options.map((option) => [option.id, selection.choices[option.id] ?? option.defaultChoiceId]));
  return { kind: 'listed', models, waiting, current: { kind: 'pinned', model, choices } };
}

/** The saved access against what the provider offers for interactive turns. */
export type CurrentAccess =
  | { readonly kind: 'offered'; readonly profile: AccessProfile }
  /** Held back, with the provider's reason: no segment is selected and sending is blocked. */
  | { readonly kind: 'withheld'; readonly reason: string }
  | { readonly kind: 'not-offered' };

export interface AccessState {
  readonly offered: readonly AccessProfile[];
  readonly approvals: boolean;
  readonly current: CurrentAccess;
}

export interface AccessKey {
  readonly access: AccessLevel;
  readonly vendorSettings: VendorSettings;
}

export const sameAccess = (a: AccessKey, b: AccessKey): boolean => a.access === b.access && a.vendorSettings === b.vendorSettings;

export const accessKey = (profile: AccessKey): string => `${profile.access}/${profile.vendorSettings}`;

/** Null while the provider is not ready. */
export function accessState(info: ProviderInfo | undefined, saved: AccessKey): AccessState | null {
  const ready = readyInfo(info);
  if (ready === null) return null;
  const offered = interactiveProfiles(ready);
  const { withheld, approvals } = ready.capabilities;
  const profile = offered.find((each) => sameAccess(each, saved));
  const held = withheld.find((each) => sameAccess(each, saved));
  const current: CurrentAccess =
    profile !== undefined ? { kind: 'offered', profile } : held !== undefined ? { kind: 'withheld', reason: held.reason } : { kind: 'not-offered' };
  return { offered, approvals, current };
}

/** Whether a change gives the agent full access it did not have: the moment the one-time notice is for. */
export function turnsOnFull(before: ProviderBinding, after: ProviderBinding): boolean {
  const full = (binding: ProviderBinding): boolean => binding.kind === 'bound' && binding.access === 'full';
  return full(after) && !full(before);
}

/** Why `choice` cannot run: if `saved`'s own profile is withheld when zero profiles are offered, shows that redacted reason. */
export function unrunnableReason(choice: ProviderChoice | undefined, saved: AccessKey | null, redact: (text: string) => string): string {
  if (choice === undefined) return "This agent's provider isn't installed.";
  const readiness = readinessOf(choice);
  if (readiness.kind === 'no-access' && saved !== null) {
    const current = accessState(choice.info, saved)?.current;
    if (current?.kind === 'withheld') return `${choice.name}: ${withheldReason(current.reason, redact)}`;
  }
  return `${choice.name}: ${statusLine(readiness)}`;
}
