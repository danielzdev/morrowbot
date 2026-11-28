import type { DatabaseSync } from 'node:sqlite';
import { AgentGrant, DevicePlatform, EntityId, Member, type MemberAccess, type MemberStatus } from '@morrowbot/contracts';
import { z } from 'zod';

const MemberRow = z.object({
  member_id: z.string(),
  name: z.string(),
  role: z.enum(['co-owner', 'scoped']),
  device_name: z.string().nullable(),
  platform: DevicePlatform.nullable(),
  created_at: z.string(),
  last_seen_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});
type MemberRow = z.infer<typeof MemberRow>;

const GrantRow = z
  .object({ member_id: z.string(), agent_id: z.string(), can_edit: z.number(), workspace: z.string(), inter_agent_allowlist: z.string() })
  .transform((row) => ({
    memberId: row.member_id,
    grant: AgentGrant.parse({
      agentId: row.agent_id,
      canEdit: row.can_edit === 1,
      workspace: row.workspace,
      interAgentAllowlist: z.array(EntityId).parse(JSON.parse(row.inter_agent_allowlist)),
    }),
  }));

const IdRow = z.object({ member_id: z.string() });
const AllowlistRow = z.object({ inter_agent_allowlist: z.string() });

/** A member as stored before its status is worked out. */
export interface NewMember {
  readonly memberId: string;
  readonly name: string;
  readonly access: MemberAccess;
  readonly createdAt: string;
}

export interface MemberClaim {
  readonly codeHash: string;
  readonly tokenHash: string;
  readonly deviceName: string;
  readonly platform: DevicePlatform;
  readonly at: string;
}

export interface MemberRepository {
  /** The member, its grants and its invite, in one transaction. */
  insert(member: NewMember, codeHash: string, expiresAt: string): void;
  /** Uses an open invite once: the member gets its token. Undefined for an unknown, used or expired code, or a revoked member. */
  claim(claim: MemberClaim): string | undefined;
  /** The joined member holding this token hash, unless it was revoked. */
  activeByTokenHash(tokenHash: string): string | undefined;
  /** Undefined for an unknown member. `now` decides whether an unused invite expired. */
  get(memberId: string, now: string): Member | undefined;
  list(now: string): Member[];
  touch(memberId: string, at: string): void;
  /** Keeps the first revocation time. False when no such member exists. */
  revoke(memberId: string, at: string): boolean;
  /** The allowlist of every grant of `agentId` to a member who is not revoked. */
  allowlistsOf(agentId: string): string[][];
}

export function memberRepository(db: DatabaseSync): MemberRepository {
  const insertMember = db.prepare('INSERT INTO members (member_id, name, role, created_at) VALUES (?, ?, ?, ?)');
  const insertGrant = db.prepare(
    `INSERT INTO member_agent_grants (member_id, agent_id, position, can_edit, workspace, inter_agent_allowlist) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertInvite = db.prepare('INSERT INTO member_invites (code_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const openInvite = db.prepare(
    `SELECT i.member_id FROM member_invites i JOIN members m USING (member_id)
     WHERE i.code_hash = ? AND i.claimed_at IS NULL AND i.expires_at > ? AND m.revoked_at IS NULL AND m.token_hash IS NULL`,
  );
  const useInvite = db.prepare('UPDATE member_invites SET claimed_at = ? WHERE code_hash = ?');
  const join = db.prepare('UPDATE members SET token_hash = ?, device_name = ?, platform = ?, joined_at = ?, last_seen_at = ? WHERE member_id = ?');
  const active = db.prepare('SELECT member_id FROM members WHERE token_hash = ? AND revoked_at IS NULL');
  const select = `SELECT m.member_id, m.name, m.role, m.device_name, m.platform, m.created_at, m.last_seen_at, m.revoked_at,
      (SELECT max(expires_at) FROM member_invites i WHERE i.member_id = m.member_id) AS expires_at
    FROM members m`;
  const one = db.prepare(`${select} WHERE m.member_id = ?`);
  const all = db.prepare(`${select} ORDER BY m.created_at, m.rowid`);
  const grantsOf = db.prepare('SELECT * FROM member_agent_grants WHERE member_id = ? ORDER BY position');
  const allGrants = db.prepare('SELECT * FROM member_agent_grants ORDER BY member_id, position');
  const touch = db.prepare('UPDATE members SET last_seen_at = ? WHERE member_id = ? AND token_hash IS NOT NULL');
  const revoke = db.prepare('UPDATE members SET revoked_at = COALESCE(revoked_at, ?) WHERE member_id = ?');
  const allowlists = db.prepare(
    `SELECT g.inter_agent_allowlist FROM member_agent_grants g JOIN members m USING (member_id) WHERE g.agent_id = ? AND m.revoked_at IS NULL`,
  );

  const inTransaction = <T>(work: () => T): T => {
    db.exec('SAVEPOINT members');
    try {
      const result = work();
      db.exec('RELEASE members');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO members');
      db.exec('RELEASE members');
      throw error;
    }
  };

  return {
    insert: (member, codeHash, expiresAt) => {
      inTransaction(() => {
        insertMember.run(member.memberId, member.name, member.access.kind, member.createdAt);
        if (member.access.kind === 'scoped') {
          for (const [position, grant] of member.access.agents.entries()) {
            insertGrant.run(member.memberId, grant.agentId, position, grant.canEdit ? 1 : 0, grant.workspace, JSON.stringify(grant.interAgentAllowlist));
          }
        }
        insertInvite.run(codeHash, member.memberId, member.createdAt, expiresAt);
      });
    },
    claim: (claim) =>
      inTransaction(() => {
        const row = openInvite.get(claim.codeHash, claim.at);
        if (row === undefined) return undefined;
        const { member_id: memberId } = IdRow.parse(row);
        useInvite.run(claim.at, claim.codeHash);
        join.run(claim.tokenHash, claim.deviceName, claim.platform, claim.at, claim.at, memberId);
        return memberId;
      }),
    activeByTokenHash: (tokenHash) => {
      const row = active.get(tokenHash);
      return row === undefined ? undefined : IdRow.parse(row).member_id;
    },
    get: (memberId, now) => {
      const row = one.get(memberId);
      if (row === undefined) return undefined;
      return memberOf(MemberRow.parse(row), grantsOf.all(memberId).map((each) => GrantRow.parse(each).grant), now);
    },
    list: (now) => {
      const grants = new Map<string, AgentGrant[]>();
      for (const each of allGrants.all()) {
        const { memberId, grant } = GrantRow.parse(each);
        grants.set(memberId, [...(grants.get(memberId) ?? []), grant]);
      }
      return all.all().map((each) => {
        const row = MemberRow.parse(each);
        return memberOf(row, grants.get(row.member_id) ?? [], now);
      });
    },
    touch: (memberId, at) => {
      touch.run(at, memberId);
    },
    revoke: (memberId, at) => revoke.run(at, memberId).changes > 0,
    allowlistsOf: (agentId) =>
      allowlists.all(agentId).map((each) => z.array(EntityId).parse(JSON.parse(AllowlistRow.parse(each).inter_agent_allowlist))),
  };
}

function memberOf(row: MemberRow, grants: AgentGrant[], now: string): Member {
  const access: MemberAccess = row.role === 'co-owner' ? { kind: 'co-owner' } : { kind: 'scoped', agents: grants };
  return Member.parse({ memberId: row.member_id, name: row.name, access, status: statusOf(row, now), createdAt: row.created_at });
}

function statusOf(row: MemberRow, now: string): MemberStatus {
  if (row.revoked_at !== null) return { kind: 'revoked', revokedAt: row.revoked_at };
  if (row.device_name !== null && row.platform !== null && row.last_seen_at !== null) {
    return { kind: 'joined', deviceName: row.device_name, platform: row.platform, lastSeenAt: row.last_seen_at };
  }
  const expiresAt = row.expires_at ?? row.created_at;
  return expiresAt > now ? { kind: 'invited', expiresAt } : { kind: 'expired', expiredAt: expiresAt };
}
