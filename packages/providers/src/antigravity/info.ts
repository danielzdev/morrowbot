import type { ProviderCapabilities } from '@morrowbot/contracts';
import type { AccessProfile, ProviderInfo, ProviderModel, WithheldProfile } from '@morrowbot/plugin-sdk';
import type { Version } from './version.ts';

/**
 * The profiles the agy 1.5.18 fixtures prove. Read-only: agy in Default mode with every write and
 * command denied; a read outside the workspace goes to an approval card, so it is interactive only.
 * Full: agy still in Default mode, and MorrowBot allows each thing it asks for once, without a card,
 * so it runs in the background too. Stop cancels the turn (`session/cancel`), which ends the command
 * agy is running; something a command leaves running in the background is not ended. Only the owner
 * may choose full; nothing picks it by default.
 */
const PROFILES: readonly AccessProfile[] = [
  { access: 'read-only', vendorSettings: 'personal', modes: ['interactive'], readsOutsideCwd: true },
  { access: 'full', vendorSettings: 'personal', modes: ['interactive', 'background'], readsOutsideCwd: true },
];

const INSTRUCTIONS_REASON =
  "Antigravity always loads the workspace's own AGENTS.md (checked on agy 1.5.18), so MorrowBot cannot replace its instructions. MorrowBot still sends the agent's SOUL.md.";
const WRITE_REASON =
  "MorrowBot can't yet confine Antigravity's file writes to the workspace, and agy runs commands outside any sandbox. Use Full access instead.";

const STATIC_WITHHELD: readonly WithheldProfile[] = [
  { access: 'workspace-write', vendorSettings: 'personal', reason: WRITE_REASON },
  { access: 'read-only', vendorSettings: 'isolated', reason: INSTRUCTIONS_REASON },
  { access: 'workspace-write', vendorSettings: 'isolated', reason: INSTRUCTIONS_REASON },
  { access: 'full', vendorSettings: 'isolated', reason: INSTRUCTIONS_REASON },
];

/** Why every profile is held back on `platform`, or null. */
export function platformReason(platform: string): string | null {
  return platform === 'darwin' ? null : `Antigravity in MorrowBot has been checked only on macOS so far, not on ${platform}.`;
}

export interface Seen {
  /** The plan agy last reported, such as "Google AI Ultra". */
  readonly tier: string | null;
  /** The models agy has listed, or null before its first session. */
  readonly models: readonly ProviderModel[] | null;
  /** Why turns stopped being offered in this run (agy changed something without asking), or null. */
  readonly breach: string | null;
}

type Runnable = Extract<Version, { kind: 'supported' | 'above' }>;

/**
 * The answer for a CLI in or above the tested range. agy lists its models only inside a session,
 * so this is `ready-models-later` until a probe or a turn has opened one. agy reports a plan but no account,
 * so the account key is always '' and every turn is stateless: MorrowBot never resumes a session.
 */
export function readyInfo(version: Runnable, seen: Seen, platform: string): ProviderInfo {
  const held = [version.kind === 'above' ? version.reason : null, platformReason(platform), seen.breach].filter((reason) => reason !== null);
  const withheld: WithheldProfile[] = [
    ...(held.length === 0 ? [] : PROFILES.map(({ access, vendorSettings }) => ({ access, vendorSettings, reason: held.join(' ') }))),
    ...STATIC_WITHHELD,
  ];
  const capabilities: ProviderCapabilities = { profiles: held.length === 0 ? [...PROFILES] : [], approvals: true, sessions: false, usage: 'none', withheld };
  const ready = {
    version: version.version,
    accountKey: '',
    accountLabel: seen.tier,
    capabilities,
    warning: version.kind === 'above' ? 'untested CLI version' : null,
  };
  return seen.models === null ? { kind: 'ready-models-later', ...ready } : { kind: 'ready', ...ready, models: [...seen.models] };
}
