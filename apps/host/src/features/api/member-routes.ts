import { ClaimInviteRequest, type ClaimInviteResponse, CreateInviteRequest, type InviteResponse, inviteUri, type MemberList } from '@morrowbot/contracts';
import type { ApiMembers } from './ports.ts';
import { failure, json, noContent, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

export interface MemberRouteOptions {
  readonly members: ApiMembers;
  readonly hostName: string;
  readonly hostVersion: string;
  /** The listen URL when the host is bound to one LAN or Tailscale address; undefined for loopback or every interface. */
  readonly remoteUrl: () => string | undefined;
  readonly closeMemberSockets: (memberId: string) => void;
}

export function memberRoutes(options: MemberRouteOptions): Route[] {
  const { members } = options;
  return [
    {
      method: 'GET',
      path: '/api/me',
      access: { kind: 'signed-in' },
      handle: ({ whoAmI }) => json(200, whoAmI),
    },
    {
      method: 'POST',
      path: '/api/members/invites',
      access: { kind: 'host' },
      handle: async (context) => {
        const request = await parseBody(context, CreateInviteRequest);
        if (request.kind === 'rejected') return request.reply;
        const url = request.value.url ?? options.remoteUrl();
        if (url === undefined) {
          return failure('conflict', 'Set ORIBOT_HOST_BIND to a LAN or Tailscale address, or send the url members should use');
        }
        const invited = members.invite({ name: request.value.name, access: request.value.access });
        if (invited.kind === 'invalid') return failure('invalid_request', invited.reason);
        const body: InviteResponse = { member: invited.member, code: invited.code, url, inviteUri: inviteUri(url, invited.code) };
        return json(201, body);
      },
    },
    {
      method: 'POST',
      path: '/api/members/claim',
      access: { kind: 'public' },
      handle: async (context) => {
        const request = await parseBody(context, ClaimInviteRequest);
        if (request.kind === 'rejected') return request.reply;
        const claimed = members.claim(request.value);
        if (claimed.kind === 'wrong-code') return failure('unauthorized', 'This invite is wrong, used, expired or revoked. Ask for a new one.');
        const body: ClaimInviteResponse = { memberId: claimed.memberId, token: claimed.token, hostName: options.hostName, hostVersion: options.hostVersion };
        return json(201, body);
      },
    },
    {
      method: 'GET',
      path: '/api/members',
      access: { kind: 'host' },
      handle: () => {
        const body: MemberList = { members: members.list() };
        return json(200, body);
      },
    },
    {
      method: 'DELETE',
      path: '/api/members/:id',
      access: { kind: 'host' },
      handle: ({ params }) => {
        const memberId = params.get('id');
        if (!members.revoke(memberId)) return notFound('Member');
        options.closeMemberSockets(memberId);
        return noContent();
      },
    },
  ];
}
