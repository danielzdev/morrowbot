import type { AccessProfile, ModelSelection, ProviderBinding, ProviderInfo, ProviderModel } from '@morrowbot/contracts';
import { planLabel } from '../privacy.ts';

/** A provider as every picker sees it (spec §4.6): its list entry and the info it last reported. */
export interface ProviderChoice {
  readonly id: string;
  /** Short display name, such as "Codex". */
  readonly name: string;
  /** What runs the turns, such as "Claude Code": the Auto pill says it chose the model. */
  readonly runtime: string;
  /** From the provider list, not from `ProviderInfo`. */
  readonly enabled: boolean;
  /** Undefined until it loads, and while the provider's process is not running. */
  readonly info: ProviderInfo | undefined;
  /** The process's own status line while it is not running ("Stopped unexpectedly"), else null. */
  readonly down: string | null;
}

export type ReadyInfo = Extract<ProviderInfo, { kind: 'ready' | 'ready-models-later' }>;

export const readyInfo = (info: ProviderInfo | undefined): ReadyInfo | null =>
  info?.kind === 'ready' || info?.kind === 'ready-models-later' ? info : null;

export const interactiveProfiles = (info: ReadyInfo): readonly AccessProfile[] =>
  info.capabilities.profiles.filter((profile) => profile.modes.includes('interactive'));

/** The one readiness rule (spec §4.6): enabled, ready, and at least one interactive profile. */
export function isRunnable(provider: { readonly enabled: boolean; readonly info: ProviderInfo | undefined }): boolean {
  const info = readyInfo(provider.info);
  return provider.enabled && info !== null && interactiveProfiles(info).length > 0;
}

/** Runnable with no warning: only these are ever prefilled or picked automatically. */
export function isAutoSelectable(provider: { readonly enabled: boolean; readonly info: ProviderInfo | undefined }): boolean {
  return isRunnable(provider) && readyInfo(provider.info)?.warning === null;
}

/** What a provider row says about itself (spec §6.2); each non-runnable kind has its own line. */
export type Readiness =
  | { readonly kind: 'ready'; readonly warned: boolean; readonly plan: string | null }
  | { readonly kind: 'off' }
  | { readonly kind: 'down'; readonly line: string }
  | { readonly kind: 'checking' }
  | { readonly kind: 'missing-runtime' }
  | { readonly kind: 'outdated'; readonly found: string; readonly supported: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'error' }
  | { readonly kind: 'no-access' };

export function readinessOf(choice: ProviderChoice): Readiness {
  if (!choice.enabled) return { kind: 'off' };
  if (choice.down !== null) return { kind: 'down', line: choice.down };
  const { info } = choice;
  if (info === undefined) return { kind: 'checking' };
  switch (info.kind) {
    case 'missing-runtime':
      return { kind: 'missing-runtime' };
    case 'outdated':
      return { kind: 'outdated', found: info.found, supported: info.supported };
    case 'signed-out':
      return { kind: 'signed-out' };
    case 'error':
      return { kind: 'error' };
    case 'ready':
    case 'ready-models-later':
      if (interactiveProfiles(info).length === 0) return { kind: 'no-access' };
      return { kind: 'ready', warned: info.warning !== null, plan: info.accountLabel === null ? null : planLabel(info.accountLabel) };
  }
}

export function statusLine(readiness: Readiness): string {
  switch (readiness.kind) {
    case 'ready':
      if (readiness.warned) return "Ready · Review this provider's status";
      return readiness.plan === null ? 'Ready' : `Ready · ${readiness.plan}`;
    case 'off':
      return 'Turned off';
    case 'down':
      return readiness.line;
    case 'checking':
      return 'Checking…';
    case 'missing-runtime':
      return 'Not installed';
    case 'outdated':
      return `Needs update · found ${readiness.found}, needs ${readiness.supported}`;
    case 'signed-out':
      return 'Sign-in needed';
    case 'error':
      return "Couldn't check provider";
    case 'no-access':
      return 'No interactive access is available';
  }
}

/** Whether a profile shows a warning: it reads outside the workspace, or loads the user's own CLI setup. */
export const hasWarnings = (profile: AccessProfile): boolean => profile.readsOutsideCwd || profile.vendorSettings === 'personal';

/** The first interactive profile with no warnings, else the first interactive one (its warnings are shown). */
export function defaultProfile(info: ReadyInfo): AccessProfile | null {
  const interactive = interactiveProfiles(info);
  return interactive.find((profile) => !hasWarnings(profile)) ?? interactive[0] ?? null;
}

/** `model` pinned with each option at its default. */
export function pinModel(model: ProviderModel): ModelSelection {
  return { kind: 'model', id: model.id, choices: Object.fromEntries(model.options.map((option) => [option.id, option.defaultChoiceId])) };
}

/** A pinned selection with one option changed. Auto has no options: pin a model first. */
export function withChoice(selection: ModelSelection, optionId: string, choiceId: string): ModelSelection {
  return selection.kind === 'default' ? selection : { ...selection, choices: { ...selection.choices, [optionId]: choiceId } };
}

/** The selection a new binding stores: the Recommended (else first) listed model; Auto only when none is listed. */
export function initialSelection(info: ReadyInfo): ModelSelection {
  const models = info.kind === 'ready' ? info.models : [];
  const model = models.find(({ isDefault }) => isDefault) ?? models[0];
  return model === undefined ? { kind: 'default' } : pinModel(model);
}

/** A fresh binding to `choice` (New Agent, or a provider switch); unbound when it can't run. */
export function newBinding(choice: ProviderChoice): ProviderBinding {
  const info = readyInfo(choice.info);
  const profile = info === null ? null : defaultProfile(info);
  if (!isRunnable(choice) || info === null || profile === null) return { kind: 'unbound' };
  return { kind: 'bound', pluginId: choice.id, selection: initialSelection(info), access: profile.access, vendorSettings: profile.vendorSettings };
}

/** The provider New Agent and first run start on: the first one eligible for automatic selection. */
export const prefill = (choices: readonly ProviderChoice[]): ProviderChoice | null => choices.find(isAutoSelectable) ?? null;
