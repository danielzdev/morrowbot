import type { Agent, CreateInviteRequest, Member, MemberList, WorkspaceConfinement } from '@morrowbot/contracts';
import type { Api } from '../../shared/api.ts';
import { relativeTime } from '../../shared/format.ts';

/** The host calls Settings › Members makes, and the clipboard for the invite link. */
export type MembersPort = Pick<Api, 'createInvite' | 'listMembers' | 'revokeMember' | 'listAgents'> & { readonly copy: (text: string) => Promise<void> };

/** What the invite form holds. A co-owner ignores the agent fields. */
export interface InviteDraft {
  readonly name: string;
  readonly role: 'co-owner' | 'scoped';
  readonly agentIds: ReadonlySet<string>;
  readonly canEdit: boolean;
  readonly workspace: WorkspaceConfinement;
  /** Agents the shared ones may start messaging; none by default. */
  readonly allowlist: ReadonlySet<string>;
}

export const EMPTY_DRAFT: InviteDraft = { name: '', role: 'scoped', agentIds: new Set(), canEdit: false, workspace: 'read-only', allowlist: new Set() };

/** Why the draft cannot be sent yet, or null. */
export function draftProblem(draft: InviteDraft): string | null {
  if (draft.name.trim() === '') return 'Give them a name you will recognise.';
  if (draft.role === 'scoped' && draft.agentIds.size === 0) return 'Choose at least one agent.';
  return null;
}

export function inviteRequest(draft: InviteDraft, url: string | null): CreateInviteRequest {
  const access: CreateInviteRequest['access'] =
    draft.role === 'co-owner'
      ? { kind: 'co-owner' }
      : {
          kind: 'scoped',
          agents: [...draft.agentIds].map((agentId) => ({
            agentId,
            canEdit: draft.canEdit,
            workspace: draft.workspace,
            interAgentAllowlist: [...draft.allowlist].filter((id) => id !== agentId),
          })),
        };
  return { name: draft.name.trim(), access, ...(url === null ? {} : { url }) };
}

/** Members who can still reach the server or are yet to join, newest first. */
export function currentMembers(list: MemberList): readonly Member[] {
  return list.members.filter(({ status }) => status.kind !== 'revoked').toReversed();
}

/** What a member may use, in a few words. */
export function accessSummary(member: Member, agents: readonly Agent[]): string {
  switch (member.access.kind) {
    case 'co-owner':
      return 'Full co-owner';
    case 'scoped': {
      const grants = member.access.agents;
      const names = grants.map(({ agentId }) => agents.find(({ id }) => id === agentId)?.name ?? 'a deleted agent');
      const edit = grants.some(({ canEdit }) => canEdit) ? ' · can edit' : '';
      const write = grants.some(({ workspace }) => workspace === 'workspace-write') ? ' · may write in its folder' : ' · read-only';
      return names.length === 0 ? 'No agents left' : `${names.join(', ')}${edit}${write}`;
    }
  }
}

/** Where a member stands, for the line under its name. */
export function statusLine(member: Member, now: number): string {
  const { status } = member;
  switch (status.kind) {
    case 'invited': {
      const left = Math.max(1, Math.ceil((Date.parse(status.expiresAt) - now) / 86_400_000));
      return `Invite not used yet · expires in ${String(left)} ${left === 1 ? 'day' : 'days'}`;
    }
    case 'expired':
      return 'Invite expired unused';
    case 'joined': {
      const age = relativeTime(status.lastSeenAt, now);
      return `Joined on ${status.deviceName} · last seen ${age === 'now' ? 'just now' : `${age} ago`}`;
    }
    case 'revoked':
      return 'Revoked';
  }
}

/** Toggles one id in a set, as a new set. */
export function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}
