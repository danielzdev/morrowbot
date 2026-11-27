import type { AccessProfile, ProviderInfo, ProviderModel } from '@morrowbot/plugin-sdk';
import type { Auth } from './auth.ts';
import type { Policy } from './policy.ts';
import type { Version } from './version.ts';

/**
 * The profiles the 2.1.332 fixtures have proven: both isolated, both confined to the workspace by
 * `--restricted`, neither with a shell. Workspace-write asks before protected paths such as `.git/`,
 * and its fixtures have run on macOS only.
 */
const PROFILES: readonly AccessProfile[] = [
  { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false },
  { access: 'workspace-write', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: false },
];

const model = (id: string, label: string): ProviderModel => ({ id, label, isDefault: false, options: [] });

/** Claude Code's model aliases. Claude Code's own choice is the `default` selection, which passes no `--model`. */
export const MODELS: readonly ProviderModel[] = [
  model('fable', 'Fable'),
  model('opus', 'Opus'),
  model('sonnet', 'Sonnet'),
  model('haiku', 'Haiku'),
];

/** Why `access` is held back on `platform` whatever else holds, or null. */
export function platformReason(access: AccessProfile['access'], platform: string): string | null {
  if (access !== 'workspace-write' || platform === 'darwin') return null;
  return `Workspace-write for Claude has been checked only on macOS so far, not on ${platform}.`;
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
