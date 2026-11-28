import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';
import { DevicePlatform, HostUrl } from './pairing.ts';

/** How long an invite link stays claimable. */
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60_000;

/** An invite's secret: 16 random bytes, base64url. Too long to guess, so claims need no throttle. */
export const InviteCode = z.string().regex(/^[\w-]{22}$/, 'Expected a 22-character invite code');
export type InviteCode = z.infer<typeof InviteCode>;

/** The most a scoped member's turn may change: `read-only`, or writing only inside the agent's own dedicated folder. */
export const WorkspaceConfinement = z.enum(['read-only', 'workspace-write']);
export type WorkspaceConfinement = z.infer<typeof WorkspaceConfinement>;

const MemberName = z.string().trim().min(1).max(100);

/** One agent a scoped member may see and chat with. `interAgentAllowlist` names the only agents it may start messaging. */
export const AgentGrant = z.strictObject({
  agentId: EntityId,
  canEdit: z.boolean(),
  workspace: WorkspaceConfinement,
  interAgentAllowlist: z.array(EntityId).max(200).default([]),
});
export type AgentGrant = z.infer<typeof AgentGrant>;

/** What a member may do: everything but managing devices and members (`co-owner`), or only the listed agents (`scoped`). */
export const MemberAccess = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('co-owner') }),
  z.strictObject({
    kind: z.literal('scoped'),
    /** Empty once every granted agent was deleted. */
    agents: z
      .array(AgentGrant)
      .max(200)
      .refine((grants) => new Set(grants.map(({ agentId }) => agentId)).size === grants.length, 'Each agent once'),
  }),
]);
export type MemberAccess = z.infer<typeof MemberAccess>;

/** Where a member stands: invited (the link not yet used), joined, expired unused, or revoked. */
export const MemberStatus = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('invited'), expiresAt: Timestamp }),
  z.strictObject({ kind: z.literal('expired'), expiredAt: Timestamp }),
  z.strictObject({ kind: z.literal('joined'), deviceName: z.string().min(1), platform: DevicePlatform, lastSeenAt: Timestamp }),
  z.strictObject({ kind: z.literal('revoked'), revokedAt: Timestamp }),
]);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const Member = z.strictObject({
  memberId: EntityId,
  name: MemberName,
  access: MemberAccess,
  status: MemberStatus,
  createdAt: Timestamp,
});
export type Member = z.infer<typeof Member>;

export const MemberList = z.strictObject({ members: z.array(Member) });
export type MemberList = z.infer<typeof MemberList>;

/** `url` is the address the member's app should use; it defaults to the host's own LAN or Tailscale listen address. */
export const CreateInviteRequest = z.strictObject({
  name: MemberName,
  access: MemberAccess.refine((access) => access.kind === 'co-owner' || access.agents.length > 0, 'Choose at least one agent'),
  url: HostUrl.optional(),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const InviteResponse = z.strictObject({
  member: Member,
  code: InviteCode,
  url: HostUrl,
  /** The link to send: `morrowbot://join?url=<url>&code=<code>`. */
  inviteUri: z.string().startsWith('morrowbot://join?'),
});
export type InviteResponse = z.infer<typeof InviteResponse>;

export const ClaimInviteRequest = z.strictObject({
  code: InviteCode,
  deviceName: z.string().trim().min(1).max(100),
  platform: DevicePlatform,
});
export type ClaimInviteRequest = z.infer<typeof ClaimInviteRequest>;

export const ClaimInviteResponse = z.strictObject({
  memberId: EntityId,
  /** The member's long-lived Bearer token. The host keeps only its hash and never shows it again. */
  token: z.string().min(32),
  hostName: z.string().min(1),
  hostVersion: z.string().min(1),
});
export type ClaimInviteResponse = z.infer<typeof ClaimInviteResponse>;

/** `GET /api/me`: who the caller is on this host, so a client can hide what it may not use. */
export const WhoAmI = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owner') }),
  z.strictObject({ kind: z.literal('member'), memberId: EntityId, name: MemberName, access: MemberAccess }),
]);
export type WhoAmI = z.infer<typeof WhoAmI>;

/** The link an invite is sent as. */
export function inviteUri(url: HostUrl, code: InviteCode): string {
  return `morrowbot://join?${new URLSearchParams({ url, code }).toString()}`;
}

/** What someone joining a server typed or pasted: an invite, or a device pairing code (the owner's own other computer). */
export type JoinTarget =
  | { readonly kind: 'invite'; readonly url: HostUrl; readonly code: InviteCode }
  | { readonly kind: 'pairing'; readonly url: HostUrl; readonly code: string }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Reads a pasted `morrowbot://join` or `morrowbot://pair` link, or a host address plus an invite or 6-digit pairing code. */
export function parseJoinTarget(link: string, typedUrl: string, typedCode: string): JoinTarget {
  const pasted = link.trim();
  if (pasted !== '') {
    const parsed = URL.parse(pasted);
    const kind = parsed?.protocol === 'morrowbot:' ? parsed.host : '';
    if (parsed === null || (kind !== 'join' && kind !== 'pair')) return { kind: 'invalid', reason: 'Paste a morrowbot://join link' };
    return targetOf(parsed.searchParams.get('url') ?? '', parsed.searchParams.get('code') ?? '');
  }
  return targetOf(typedUrl.trim(), typedCode.trim().replaceAll(' ', ''));
}

function targetOf(rawUrl: string, code: string): JoinTarget {
  const url = HostUrl.safeParse(rawUrl);
  if (!url.success) return { kind: 'invalid', reason: 'Use a server address such as https://studio.example.ts.net or http://100.64.0.1:47800' };
  if (/^\d{6}$/.test(code)) return { kind: 'pairing', url: url.data, code };
  const invite = InviteCode.safeParse(code);
  return invite.success ? { kind: 'invite', url: url.data, code: invite.data } : { kind: 'invalid', reason: 'Enter the invite code or 6-digit pairing code' };
}
