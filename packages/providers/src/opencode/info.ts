import type { ProviderCapabilities } from '@morrowbot/contracts';
import type { AccessProfile, ProviderInfo, ProviderModel, WithheldProfile } from '@morrowbot/plugin-sdk';
import type { Version } from './version.ts';

/**
 * The profiles OpenCode offers, both isolated (MorrowBot sends the agent's SOUL.md and opencode
 * loads no workspace config):
 * - `read-only`: `build` mode with no write or shell tool offered; outside reads go to an approval
 *   card, so interactive only.
 * - `full`: `full` primary agent with every tool allowed without prompting, in interactive or
 *   background mode.
 */
const READ_ONLY: AccessProfile = { access: 'read-only', vendorSettings: 'isolated', modes: ['interactive'], readsOutsideCwd: true };
const FULL: AccessProfile = { access: 'full', vendorSettings: 'isolated', modes: ['interactive', 'background'], readsOutsideCwd: true };
const PROFILES: readonly AccessProfile[] = [READ_ONLY, FULL];

const PERSONAL_REASON =
  "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's SOUL.md is sent by MorrowBot instead.";
const WRITE_REASON = 'MorrowBot cannot yet confine OpenCode file writes to the workspace, and opencode runs commands outside any sandbox.';

const STATIC_WITHHELD: readonly WithheldProfile[] = [
  { access: 'workspace-write', vendorSettings: 'isolated', reason: WRITE_REASON },
  { access: 'read-only', vendorSettings: 'personal', reason: PERSONAL_REASON },
  { access: 'workspace-write', vendorSettings: 'personal', reason: PERSONAL_REASON },
];

/** Why OpenCode profiles are held back on `platform`, or null. */
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
    ...(held.length === 0 ? [] : PROFILES.map(({ access, vendorSettings }) => ({ access, vendorSettings, reason: held.join(' ') }))),
    ...STATIC_WITHHELD,
  ];
  const capabilities: ProviderCapabilities = { profiles: held.length === 0 ? [...PROFILES] : [], approvals: true, sessions: false, usage: 'none', withheld };
  const ready = {
    version: version.version,
    accountKey: '',
    accountLabel: 'Free models',
    capabilities,
    warning: version.kind === 'above' ? 'untested CLI version' : null,
  };
  return seen.models === null ? { kind: 'ready-models-later', ...ready } : { kind: 'ready', ...ready, models: [...seen.models] };
}
