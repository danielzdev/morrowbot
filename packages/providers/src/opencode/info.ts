import type { ProviderCapabilities } from '@morrowbot/contracts';
import type { AccessProfile, ProviderInfo, ProviderModel, WithheldProfile } from '@morrowbot/plugin-sdk';
import type { Version } from './version.ts';

/**
 * The one profile the opencode 2.4.1 fixtures prove: no write or shell tool offered at all, and the
 * agent's AGENTS.md sent by MorrowBot, as opencode loads none of the workspace's own files. A read
 * outside the workspace goes to an approval card, so a turn can read there once the user allows it.
 * Interactive only: a background turn could not show that card.
 */
const READ_ONLY: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: true };

const PERSONAL_REASON =
  "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by MorrowBot instead.";
const WRITE_REASON = 'MorrowBot runs OpenCode read-only in this version: it cannot yet confine each file write to the workspace, and opencode runs commands outside any sandbox.';

const STATIC_WITHHELD: readonly WithheldProfile[] = [
  { access: 'workspace-write', vendorSettings: 'isolated', reason: WRITE_REASON },
  { access: 'read-only', vendorSettings: 'personal', reason: PERSONAL_REASON },
  { access: 'workspace-write', vendorSettings: 'personal', reason: PERSONAL_REASON },
];

/** Why read-only is held back on `platform`, or null. */
export function platformReason(platform: string): string | null {
  return platform === 'darwin' ? null : `OpenCode in MorrowBot has been checked only on macOS so far, not on ${platform}.`;
}

export interface Seen {
  /** The models opencode has listed, or null before its first session. */
  readonly models: readonly ProviderModel[] | null;
  /** Why turns are held back now (managed config, or opencode changed something without asking), or null. */
  readonly held: string | null;
}

type Runnable = Extract<Version, { kind: 'supported' | 'above' }>;

/**
 * The answer for a CLI in or above the tested range. opencode lists its models only inside a
 * session, so this is `ready-models-later` until a turn has opened one. The free models need no
 * sign-in and opencode reports no account, so the account key is always '' and every turn is
 * stateless: MorrowBot never resumes a session.
 */
export function readyInfo(version: Runnable, seen: Seen, platform: string): ProviderInfo {
  const held = [version.kind === 'above' ? version.reason : null, platformReason(platform), seen.held].filter((reason) => reason !== null);
  const withheld: WithheldProfile[] = [
    ...(held.length === 0 ? [] : [{ access: READ_ONLY.access, vendorSettings: READ_ONLY.vendorSettings, reason: held.join(' ') }]),
    ...STATIC_WITHHELD,
  ];
  const capabilities: ProviderCapabilities = { profiles: held.length === 0 ? [READ_ONLY] : [], approvals: true, sessions: false, usage: 'none', withheld };
  const ready = {
    version: version.version,
    accountKey: '',
    accountLabel: 'Free models',
    capabilities,
    warning: version.kind === 'above' ? 'untested CLI version' : null,
  };
  return seen.models === null ? { kind: 'ready-models-later', ...ready } : { kind: 'ready', ...ready, models: [...seen.models] };
}
