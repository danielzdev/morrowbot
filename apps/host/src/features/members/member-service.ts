import { createHash, randomBytes } from 'node:crypto';
import { INVITE_LIFETIME_MS, type ClaimInviteRequest, type CreateInviteRequest, type DevicePlatform, type Member, type MemberAccess } from '@morrowbot/contracts';

/** How often a member's `lastSeenAt` is written at most. */
export const MEMBER_SEEN_EVERY_MS = 60_000;

/** Where members are kept (the storage feature provides it). */
export interface MemberRecords {
  insert(
    member: { readonly memberId: string; readonly name: string; readonly access: MemberAccess; readonly createdAt: string },
    codeHash: string,
    expiresAt: string,
  ): void;
  claim(claim: {
    readonly codeHash: string;
    readonly tokenHash: string;
    readonly deviceName: string;
    readonly platform: DevicePlatform;
    readonly at: string;
  }): string | undefined;
  activeByTokenHash(tokenHash: string): string | undefined;
  get(memberId: string, now: string): Member | undefined;
  list(now: string): Member[];
  touch(memberId: string, at: string): void;
  revoke(memberId: string, at: string): boolean;
  allowlistsOf(agentId: string): string[][];
}

export interface MemberServiceOptions {
  readonly records: MemberRecords;
  /** An agent's workspace kind, or undefined for an unknown agent. */
  readonly workspaceOf: (agentId: string) => 'dedicated' | 'shared' | undefined;
  readonly newId: () => string;
  readonly now: () => string;
}

export type InviteResult =
  | { readonly kind: 'invited'; readonly member: Member; readonly code: string }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface MemberService {
  /** Creates the member with its access and a one-time invite code that is never stored. */
  invite(request: Omit<CreateInviteRequest, 'url'>): InviteResult;
  /** Uses an invite once and returns the member's long-lived token. */
  claim(request: ClaimInviteRequest): { readonly kind: 'claimed'; readonly memberId: string; readonly token: string } | { readonly kind: 'wrong-code' };
  /** The joined, unrevoked member holding `token`, with its access as stored now. */
  authenticate(token: string): Member | undefined;
  list(): Member[];
  revoke(memberId: string): boolean;
  /**
   * Whether `fromAgentId` may start a message to `toAgentId`: an agent shared with scoped members may message only
   * agents on every one of their grants' allowlists (none by default). An agent shared with nobody is not limited.
   */
  mayMessage(fromAgentId: string, toAgentId: string): boolean;
}

export function createMemberService(options: MemberServiceOptions): MemberService {
  const { records, now } = options;
  const lastWritten = new Map<string, number>();
  return {
    invite: (request) => {
      const problem = request.access.kind === 'scoped' ? grantProblem(request.access.agents, options.workspaceOf) : undefined;
      if (problem !== undefined) return { kind: 'invalid', reason: problem };
      const at = now();
      const code = randomBytes(16).toString('base64url');
      const memberId = options.newId();
      records.insert({ memberId, name: request.name, access: request.access, createdAt: at }, hash(code), new Date(Date.parse(at) + INVITE_LIFETIME_MS).toISOString());
      const member = records.get(memberId, at);
      if (member === undefined) throw new Error('A member was not found right after it was stored');
      return { kind: 'invited', member, code };
    },
    claim: (request) => {
      const token = randomBytes(32).toString('base64url');
      const at = now();
      const memberId = records.claim({ codeHash: hash(request.code), tokenHash: hash(token), deviceName: request.deviceName, platform: request.platform, at });
      if (memberId === undefined) return { kind: 'wrong-code' };
      lastWritten.set(memberId, Date.parse(at));
      return { kind: 'claimed', memberId, token };
    },
    authenticate: (token) => {
      if (token === '') return undefined;
      const memberId = records.activeByTokenHash(hash(token));
      if (memberId === undefined) return undefined;
      const at = now();
      const atMs = Date.parse(at);
      const written = lastWritten.get(memberId);
      if (written === undefined || atMs - written >= MEMBER_SEEN_EVERY_MS) {
        records.touch(memberId, at);
        lastWritten.set(memberId, atMs);
      }
      return records.get(memberId, at);
    },
    list: () => records.list(now()),
    revoke: (memberId) => {
      lastWritten.delete(memberId);
      return records.revoke(memberId, now());
    },
    mayMessage: (fromAgentId, toAgentId) => records.allowlistsOf(fromAgentId).every((allowed) => allowed.includes(toAgentId)),
  };
}

function grantProblem(
  grants: Extract<MemberAccess, { kind: 'scoped' }>['agents'],
  workspaceOf: MemberServiceOptions['workspaceOf'],
): string | undefined {
  for (const grant of grants) {
    const workspace = workspaceOf(grant.agentId);
    if (workspace === undefined) return `No agent ${grant.agentId}`;
    if (grant.workspace === 'workspace-write' && workspace !== 'dedicated') {
      return 'Writing is allowed only for an agent with its own dedicated folder; share this one read-only';
    }
    for (const other of grant.interAgentAllowlist) {
      if (other === grant.agentId) return 'An agent cannot be on its own allowlist';
      if (workspaceOf(other) === undefined) return `No agent ${other} for the allowlist`;
    }
  }
  return undefined;
}

function hash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
