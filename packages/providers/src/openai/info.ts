import type { AccessProfile, ProviderInfo, ProviderModel, WithheldProfile } from '@morrowbot/plugin-sdk';
import type { CodexModel } from './protocol.ts';
import type { Resolution } from './route.ts';
import type { Version } from './version.ts';

/**
 * The profiles Codex offers, both with your own Codex settings (`personal`) and reading outside
 * the workspace: read-only (with its shell tool, MCP servers, apps, plugins and hooks turned off)
 * and full access (`danger-full-access` / `dangerFullAccess` without approvals).
 */
const READ_ONLY: AccessProfile = { access: 'read-only', vendorSettings: 'personal', modes: ['interactive', 'background'], readsOutsideCwd: true };
const FULL: AccessProfile = { access: 'full', vendorSettings: 'personal', modes: ['interactive', 'background'], readsOutsideCwd: true };
const PROFILES: readonly AccessProfile[] = [READ_ONLY, FULL];

const INSTRUCTIONS_REASON =
  'Codex always loads your own ~/.codex/AGENTS.md (checked on Codex 0.171), so MorrowBot cannot replace its instructions. Use your Codex instructions instead.';
const SHELL_REASON =
  'Codex runs each shell command in its own process group, and MorrowBot cannot yet confine workspace-write commands to the workspace. Use read-only or full access instead.';

const STATIC_WITHHELD: readonly WithheldProfile[] = [
  { access: 'workspace-write', vendorSettings: 'personal', reason: SHELL_REASON },
  { access: 'read-only', vendorSettings: 'isolated', reason: INSTRUCTIONS_REASON },
  { access: 'workspace-write', vendorSettings: 'isolated', reason: INSTRUCTIONS_REASON },
];

/** Why Codex profiles are held back on `platform`, or null. */
export function platformReason(platform: string): string | null {
  return platform === 'darwin' ? null : `Codex in MorrowBot has been checked only on macOS so far, not on ${platform}.`;
}

type Runnable = Extract<Version, { kind: 'supported' | 'above' }>;
type Known = Exclude<Resolution, { kind: 'signed-out' }>;

/**
 * The `ready` answer for a CLI in or above the tested range. A route that could not be read still
 * answers `ready`, with no account and the reason as its warning, so the Plugins page can show it.
 */
export function readyInfo(version: Runnable, resolution: Known, models: readonly ProviderModel[], platform: string): ProviderInfo {
  const shared: string[] = [];
  if (version.kind === 'above') shared.push(version.reason);
  const own = platformReason(platform);
  if (own !== null) shared.push(own);
  if (resolution.kind === 'resolved' && resolution.blocked !== null) shared.push(resolution.blocked);
  const profiles = shared.length === 0 ? [...PROFILES] : [];
  const withheld: WithheldProfile[] = [
    ...(shared.length === 0 ? [] : PROFILES.map(({ access, vendorSettings }) => ({ access, vendorSettings, reason: shared.join(' ') }))),
    ...STATIC_WITHHELD,
  ];
  const warnings = [
    ...(version.kind === 'above' ? ['untested CLI version'] : []),
    ...(resolution.kind === 'failed' ? [resolution.reason] : resolution.route.kind === 'subscription' ? [] : [resolution.route.reason]),
  ];
  return {
    kind: 'ready',
    version: version.version,
    accountKey: resolution.kind === 'resolved' ? resolution.accountKey : '',
    accountLabel: resolution.kind === 'resolved' ? resolution.accountLabel : null,
    models: [...models],
    capabilities: { profiles, approvals: false, sessions: true, usage: 'live', withheld },
    warning: warnings.length === 0 ? null : warnings.join(' '),
  };
}

const EFFORTS: Readonly<Record<string, string>> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
};

/** Codex's model list as picker models, each with its reasoning efforts. Hidden models are left out. */
export function modelsOf(list: readonly CodexModel[]): ProviderModel[] {
  return list
    .filter((model) => model.hidden !== true)
    .map((model) => {
      const choices = model.supportedReasoningEfforts.map(({ reasoningEffort: id }) => ({ id, label: EFFORTS[id] ?? id }));
      const first = choices[0];
      const fallback = choices.find((choice) => choice.id === model.defaultReasoningEffort) ?? first;
      return {
        id: model.model,
        label: model.displayName || model.model,
        isDefault: model.isDefault,
        options: fallback === undefined ? [] : [{ id: 'reasoningEffort', label: 'Reasoning', defaultChoiceId: fallback.id, choices }],
      };
    });
}
