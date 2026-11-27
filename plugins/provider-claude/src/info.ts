import type { AccessProfile, ProviderInfo, ProviderModel } from '@morrowbot/plugin-sdk';
import type { Auth } from './auth.ts';
import type { Policy } from './policy.ts';
import type { Version } from './version.ts';

/** The one access profile v1 has proven for Claude Code. */
const READ_ONLY_ISOLATED: AccessProfile = {
  access: 'read-only',
  vendorSettings: 'isolated',
  modes: ['interactive', 'background'],
  readsOutsideCwd: false,
};

const model = (id: string, label: string, isDefault = false): ProviderModel => ({ id, label, isDefault, options: [] });

/** Claude Code's model aliases; `default` keeps Claude Code's own choice. */
export const MODELS: readonly ProviderModel[] = [
  model('default', 'Default', true),
  model('fable', 'Fable'),
  model('opus', 'Opus'),
  model('sonnet', 'Sonnet'),
  model('haiku', 'Haiku'),
];

type Runnable = Extract<Version, { kind: 'supported' | 'above' }>;
type SignedIn = Extract<Auth, { kind: 'personal' | 'withheld' }>;

/**
 * The `ready` answer for a CLI in or above the tested range. The read-only profile is offered only
 * when the version is tested, no managed policy applies and a personal plan is signed in; otherwise
 * it is listed as withheld with every reason. `auth` is null when policy kept `auth status` from running.
 */
export function readyInfo(version: Runnable, policy: Policy, auth: SignedIn | null): ProviderInfo {
  const reasons: string[] = [];
  if (version.kind === 'above') reasons.push(version.reason);
  if (policy.kind === 'withheld') reasons.push(policy.reason);
  if (auth?.kind === 'withheld') reasons.push(auth.reason);
  return {
    kind: 'ready',
    version: version.version,
    accountKey: auth?.accountKey ?? '',
    accountLabel: auth?.kind === 'personal' ? auth.accountLabel : null,
    models: [...MODELS],
    capabilities: {
      profiles: reasons.length === 0 ? [READ_ONLY_ISOLATED] : [],
      approvals: false,
      sessions: false,
      usage: 'none',
      withheld:
        reasons.length === 0
          ? []
          : [{ access: READ_ONLY_ISOLATED.access, vendorSettings: READ_ONLY_ISOLATED.vendorSettings, reason: reasons.join(' ') }],
    },
    warning: version.kind === 'above' ? 'untested CLI version' : null,
  };
}
