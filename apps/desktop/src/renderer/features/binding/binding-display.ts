import type { ProviderBinding } from '@morrowbot/contracts';
import { profileName, profileWarnings } from '../../shared/binding-ui/access-copy.ts';
import { accessState, modelState } from '../../shared/binding-ui/binding-state.ts';
import { isRunnable, readinessOf, readyInfo, statusLine, type ProviderChoice } from '../../shared/binding-ui/selection.ts';

export type BoundProvider = Extract<ProviderBinding, { kind: 'bound' }>;

export interface Pill {
  readonly label: string;
  readonly warn: boolean;
}

/** The binding pill: "Opus · High", "Auto · chosen by Claude Code", never the word "Default" as a model. */
export function bindingPill(choice: ProviderChoice | undefined, binding: BoundProvider): Pill {
  if (choice === undefined) return { label: 'Provider not installed', warn: true };
  const state = modelState(choice.info, binding.selection);
  if (state.kind === 'not-ready' || !isRunnable(choice)) return { label: `${choice.name} · ${statusLine(readinessOf(choice))}`, warn: true };
  const { current } = state;
  switch (current.kind) {
    case 'auto':
      return { label: state.waiting ? `${choice.name} · chosen by ${choice.runtime}` : `Auto · chosen by ${choice.runtime}`, warn: false };
    case 'unavailable':
      return { label: `${current.id} (unavailable)`, warn: true };
    case 'unreported':
      return { label: `${current.id} · availability not reported`, warn: false };
    case 'pinned': {
      const chosen = current.model.options.map((option) => option.choices.find(({ id }) => id === current.choices[option.id])?.label ?? '');
      return { label: [current.model.label, ...chosen.filter((label) => label !== '')].join(' · '), warn: false };
    }
  }
}

/** The access pill: the saved profile's name, in warning tone when it is not offered. */
export function accessPill(choice: ProviderChoice | undefined, binding: BoundProvider): Pill {
  const state = accessState(choice?.info, binding);
  const name = profileName(binding);
  if (state === null) return { label: name, warn: false };
  return state.current.kind === 'offered' ? { label: name, warn: profileWarnings(state.current.profile).length > 0 } : { label: `${name} (unavailable)`, warn: true };
}

/** Why the composer can't send with this binding, or null. Drafts and the binding are kept either way. */
export function sendBlock(agentName: string, choice: ProviderChoice | undefined, binding: ProviderBinding): string | null {
  if (binding.kind === 'unbound') return `Choose a provider for ${agentName}`;
  if (choice === undefined) return "This agent's provider isn't installed.";
  if (!isRunnable(choice)) return `${choice.name}: ${statusLine(readinessOf(choice))}`;
  const model = modelState(choice.info, binding.selection);
  if (model.kind === 'listed' && model.current.kind === 'unavailable') return 'Pick another model';
  const access = accessState(choice.info, binding);
  if (access !== null && access.current.kind !== 'offered') return "This agent's access isn't offered. Pick another in the access menu.";
  return null;
}

/** One warning-strip line under the composer (spec §4.5). */
export type ComposerWarning = { readonly kind: 'profile'; readonly text: string } | { readonly kind: 'review-provider' };

export function composerWarnings(choice: ProviderChoice | undefined, binding: ProviderBinding): readonly ComposerWarning[] {
  if (binding.kind === 'unbound' || choice === undefined) return [];
  const access = accessState(choice.info, binding);
  const profile = access?.current.kind === 'offered' ? profileWarnings(access.current.profile) : [];
  const lines: ComposerWarning[] = profile.map((text) => ({ kind: 'profile', text }));
  if ((readyInfo(choice.info)?.warning ?? null) !== null && isRunnable(choice)) lines.push({ kind: 'review-provider' });
  return lines;
}
