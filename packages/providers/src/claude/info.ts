import type { AccessProfile, ModelSelection, ProviderInfo, ProviderModel } from '@morrowbot/plugin-sdk';
import type { Auth } from './auth.ts';
import type { Policy } from './policy.ts';
import type { Version } from './version.ts';

/**
 * The profiles the 2.1.332 fixtures have proven, all isolated. Read-only and workspace-write are
 * confined to the workspace by `--restricted`, with no shell; workspace-write asks before protected
 * paths such as `.git/`. Full has the shell and reaches the whole computer without asking; only
 * the owner may grant it (new owner agents default to it when offered). Workspace-write and full have run on macOS only.
 */
const PROFILES: readonly AccessProfile[] = [
  { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false },
  { access: 'workspace-write', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false },
  { access: 'full', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: true },
];

/** The `--effort` levels of Claude Code 2.1.332, lowest first. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const EFFORT_LABELS: Readonly<Record<EffortLevel, string>> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
/** The model option the picker shows; its id is the key of the choice in `ModelSelection.choices`. */
export const EFFORT_OPTION_ID = 'effort';
const DEFAULT_EFFORT: EffortLevel = 'high';

/**
 * Claude Code's model aliases and the efforts each accepts, as 2.1.332 reports them in its
 * `initialize` answer (`fixtures/2.1.332/initialize-models.json`): Haiku 4.5 reports none, so it gets
 * no Effort option and no `--effort`. Claude Code's own choice is the `default` selection, which
 * passes neither `--model` nor `--effort`.
 */
const ALIASES: readonly { readonly id: string; readonly label: string; readonly efforts: readonly EffortLevel[] }[] = [
  { id: 'fable', label: 'Fable', efforts: EFFORT_LEVELS },
  { id: 'opus', label: 'Opus', efforts: EFFORT_LEVELS },
  { id: 'sonnet', label: 'Sonnet', efforts: EFFORT_LEVELS },
  { id: 'haiku', label: 'Haiku', efforts: EFFORT_LEVELS },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [] },
];

/** The alias the picker marks Recommended and new bindings start on. */
const RECOMMENDED = 'opus';

function defaultEffort(efforts: readonly EffortLevel[]): EffortLevel {
  return efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : (efforts[0] ?? DEFAULT_EFFORT);
}

export const MODELS: readonly ProviderModel[] = ALIASES.map(({ id, label, efforts }) => ({
  id,
  label,
  isDefault: id === RECOMMENDED,
  options:
    efforts.length === 0
      ? []
      : [
          {
            id: EFFORT_OPTION_ID,
            label: 'Effort',
            defaultChoiceId: defaultEffort(efforts),
            choices: efforts.map((effort) => ({ id: effort, label: EFFORT_LABELS[effort] })),
          },
        ],
}));

/**
 * The `--effort` a selection asks for: none (the CLI's default model, or a model id Claude Code was
 * not checked with), one its model offers (its default when none was chosen, as the picker shows),
 * or a refusal for a choice it does not offer.
 */
export type EffortChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'level'; readonly level: EffortLevel }
  | { readonly kind: 'unsupported'; readonly reason: string };

export function effortOf(selection: ModelSelection): EffortChoice {
  if (selection.kind === 'default') return { kind: 'none' };
  const alias = ALIASES.find(({ id }) => id === selection.id);
  const asked = selection.choices[EFFORT_OPTION_ID];
  if (asked === undefined) return alias === undefined || alias.efforts.length === 0 ? { kind: 'none' } : { kind: 'level', level: defaultEffort(alias.efforts) };
  const level = alias?.efforts.find((effort) => effort === asked);
  return level === undefined
    ? { kind: 'unsupported', reason: `Claude model "${selection.id}" does not offer the effort "${asked}". Pick another effort.` }
    : { kind: 'level', level };
}

/** Why `access` is held back on `platform` whatever else holds, or null. */
export function platformReason(access: AccessProfile['access'], platform: string): string | null {
  if (platform === 'darwin') return null;
  switch (access) {
    case 'read-only':
      return null;
    case 'workspace-write':
      return `Workspace-write for Claude has been checked only on macOS so far, not on ${platform}.`;
    case 'full':
      return `Full access for Claude has been checked only on macOS so far, not on ${platform}.`;
  }
}

type Runnable = Extract<Version, { kind: 'supported' | 'above' }>;
type SignedIn = Extract<Auth, { kind: 'personal' | 'withheld' }>;

/**
 * The `ready` answer for a CLI in or above the tested range. The profiles are offered only when the
 * version is tested, no managed policy applies and a personal plan is signed in; otherwise each is
 * listed as withheld with every reason, including any of `platform`'s. `auth` is null when policy kept `auth status` from running.
 */
export function readyInfo(version: Runnable, policy: Policy, auth: SignedIn | null, platform: string): ProviderInfo {
  const shared: string[] = [];
  if (version.kind === 'above') shared.push(version.reason);
  if (policy.kind === 'withheld') shared.push(policy.reason);
  if (auth?.kind === 'withheld') shared.push(auth.reason);
  const judged = PROFILES.map((profile) => {
    const own = platformReason(profile.access, platform);
    return { profile, reasons: own === null ? shared : [...shared, own] };
  });
  const profiles = judged.flatMap(({ profile, reasons }) => (reasons.length === 0 ? [profile] : []));
  return {
    kind: 'ready',
    version: version.version,
    accountKey: auth?.accountKey ?? '',
    accountLabel: auth?.kind === 'personal' ? auth.accountLabel : null,
    models: [...MODELS],
    capabilities: {
      profiles,
      approvals: profiles.some((profile) => profile.access === 'workspace-write'),
      sessions: false,
      usage: 'live',
      withheld: judged.flatMap(({ profile: { access, vendorSettings }, reasons }) =>
        reasons.length === 0 ? [] : [{ access, vendorSettings, reason: reasons.join(' ') }],
      ),
    },
    warning: version.kind === 'above' ? 'untested CLI version' : null,
  };
}
