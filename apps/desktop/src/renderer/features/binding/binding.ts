import type {
  AccessLevel,
  ModelSelection,
  ProviderBinding,
  ProviderInfo,
  ProviderModel,
  TurnMode,
  VendorSettings,
} from '@morrowbot/contracts';
import { ACCESS_LABEL } from '../../shared/labels.ts';

export type BoundProvider = Extract<ProviderBinding, { kind: 'bound' }>;

/** Shown beside the access picker: no v1 provider runs shell outside an OS sandbox. */
export const SHELL_NOTE = 'Shell commands need Codex in v1.';

export interface AccessOption {
  readonly access: AccessLevel;
  readonly vendorSettings: VendorSettings;
  readonly label: string;
  /** Warnings the user must see before picking this option. */
  readonly warnings: readonly string[];
  readonly readsOutsideCwd: boolean;
}

export interface WithheldOption {
  readonly access: AccessLevel;
  readonly vendorSettings: VendorSettings;
  readonly label: string;
  readonly reason: string;
}

export interface AccessChoices {
  readonly options: readonly AccessOption[];
  readonly withheld: readonly WithheldOption[];
  /** Why the agent's saved access cannot run now, or null when it can. */
  readonly currentProblem: string | null;
}

const labelOf = (access: AccessLevel, vendorSettings: VendorSettings): string =>
  vendorSettings === 'personal' ? `${ACCESS_LABEL[access]} · personal setup` : ACCESS_LABEL[access];

/** The access levels the provider has proven for `mode`, plus the ones it holds back and why. */
export function accessChoices(info: ProviderInfo | undefined, binding: BoundProvider, mode: TurnMode = 'interactive'): AccessChoices {
  if (info?.kind !== 'ready' && info?.kind !== 'ready-models-later') {
    return { options: [], withheld: [], currentProblem: null };
  }
  const options = info.capabilities.profiles
    .filter((profile) => profile.modes.includes(mode))
    .map((profile): AccessOption => ({
      access: profile.access,
      vendorSettings: profile.vendorSettings,
      label: labelOf(profile.access, profile.vendorSettings),
      readsOutsideCwd: profile.readsOutsideCwd,
      warnings: [
        ...(profile.readsOutsideCwd ? ['Can read your files outside the workspace.'] : []),
        ...(profile.vendorSettings === 'personal' ? ['This provider also loads your personal CLI instructions.'] : []),
      ],
    }));
  const withheld = info.capabilities.withheld.map((profile): WithheldOption => ({
    access: profile.access,
    vendorSettings: profile.vendorSettings,
    label: labelOf(profile.access, profile.vendorSettings),
    reason: profile.reason,
  }));
  const same = (other: { access: AccessLevel; vendorSettings: VendorSettings }): boolean =>
    other.access === binding.access && other.vendorSettings === binding.vendorSettings;
  const current = options.some(same)
    ? null
    : (withheld.find(same)?.reason ?? (options.length === 0 ? 'This provider offers no access level right now.' : 'This access level is not offered.'));
  return { options, withheld, currentProblem: current };
}

/** What the model picker can offer for the agent's provider. */
export type ModelChoices =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'later' }
  | {
      readonly kind: 'models';
      readonly models: readonly ProviderModel[];
      /** Null: the provider's default model. */
      readonly selected: ProviderModel | null;
      /** The choice picked for each option of the selected model. */
      readonly choices: Readonly<Record<string, string>>;
    };

export function modelChoices(info: ProviderInfo | undefined, selection: ModelSelection): ModelChoices {
  if (info?.kind === 'ready-models-later') return { kind: 'later' };
  if (info?.kind !== 'ready') return { kind: 'unavailable' };
  if (selection.kind === 'default') return { kind: 'models', models: info.models, selected: null, choices: {} };
  const selected = info.models.find(({ id }) => id === selection.id) ?? null;
  const choices = Object.fromEntries(
    (selected?.options ?? []).map((option) => [option.id, selection.choices[option.id] ?? option.defaultChoiceId]),
  );
  return { kind: 'models', models: info.models, selected, choices };
}

/** A selection of `model` with every option at its default, or the provider default for null. */
export function selectModel(model: ProviderModel | null): ModelSelection {
  if (model === null) return { kind: 'default' };
  return { kind: 'model', id: model.id, choices: Object.fromEntries(model.options.map((option) => [option.id, option.defaultChoiceId])) };
}

export function selectChoice(selection: ModelSelection, optionId: string, choiceId: string): ModelSelection {
  return selection.kind === 'default' ? selection : { ...selection, choices: { ...selection.choices, [optionId]: choiceId } };
}

/** A new binding to `pluginId`: the provider default model and its first interactive access level. */
export function bindTo(pluginId: string, info: ProviderInfo | undefined): BoundProvider {
  const profile =
    info?.kind === 'ready' || info?.kind === 'ready-models-later'
      ? info.capabilities.profiles.find((each) => each.modes.includes('interactive') && !each.readsOutsideCwd)
      : undefined;
  return {
    kind: 'bound',
    pluginId,
    selection: { kind: 'default' },
    access: profile?.access ?? 'read-only',
    vendorSettings: profile?.vendorSettings ?? 'isolated',
  };
}
