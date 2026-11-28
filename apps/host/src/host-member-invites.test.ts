import { Agent, InviteResponse, MemberList } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ECHO } from './testing/chat-fixture.ts';
import { startMemberKit, URL_FOR_MEMBERS, type MemberKit } from './testing/member-kit.ts';
import type { Reply } from './testing/test-host.ts';

let kit: MemberKit;
beforeEach(async () => {
  kit = await startMemberKit();
});
afterEach(async () => {
  await kit.close();
});

const status = async (reply: Promise<Reply>): Promise<number> => (await reply).status;

it('cuts a revoked member off at once, HTTP and socket, while a co-owner gets everything but member management', async () => {
  const shared = await kit.named('Shared');
  const guest = await kit.join('Guest', {
    kind: 'scoped',
    agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }],
  });
  const partner = await kit.join('Partner', { kind: 'co-owner' });
  const { socket } = await kit.events(guest.token);
  const closed = new Promise<string>((resolve) => {
    socket.once('close', (code, reason) => {
      resolve(`${String(code)} ${reason.toString('utf8')}`);
    });
  });
  const before = await status(kit.as(guest.token, 'GET', '/api/agents'));
  const revoked = await status(kit.chat.host.call('DELETE', `/api/members/${guest.memberId}`));

  expect({
    before,
    revoked,
    socketClosed: await closed,
    afterHttp: await kit.as(guest.token, 'GET', '/api/agents'),
    afterSocket: await kit.events(guest.token).then(
      () => 'open',
      (error: unknown) => String(error),
    ),
    members: MemberList.parse((await kit.chat.host.call('GET', '/api/members')).body).members.map(({ name, access, status: { kind } }) => ({ name, access: access.kind, status: kind })),
    coOwner: {
      plugins: await status(kit.as(partner.token, 'GET', '/api/plugins')),
      sharedThreads: await status(kit.as(partner.token, 'GET', `/api/agents/${shared.agent.id}/threads`)),
      createAgent: await status(kit.as(partner.token, 'POST', '/api/agents', { name: 'Partner bot' })),
      members: await status(kit.as(partner.token, 'GET', '/api/members')),
    },
  }).toMatchInlineSnapshot(`
    {
      "afterHttp": {
        "body": {
          "error": {
            "kind": "unauthorized",
            "message": "Missing or wrong token",
          },
        },
        "status": 401,
      },
      "afterSocket": "Error: refused 401",
      "before": 200,
      "coOwner": {
        "createAgent": 201,
        "members": 403,
        "plugins": 200,
        "sharedThreads": 200,
      },
      "members": [
        {
          "access": "scoped",
          "name": "Guest",
          "status": "revoked",
        },
        {
          "access": "co-owner",
          "name": "Partner",
          "status": "joined",
        },
      ],
      "revoked": 204,
      "socketClosed": "1008 Your access to this server was revoked",
    }
  `);
});

it('uses an invite once, and refuses grants that would let a member write outside one agent', async () => {
  const shared = await kit.chat.host.call('POST', '/api/agents', { name: 'Team', workspace: { kind: 'shared', dir: kit.chat.dataDir }, provider: ECHO });
  const teamId = Agent.parse(shared.body).id;
  const invite = InviteResponse.parse((await kit.chat.host.call('POST', '/api/members/invites', { name: 'Guest', access: { kind: 'co-owner' }, url: URL_FOR_MEMBERS })).body);
  const claim = { code: invite.code, deviceName: 'Laptop', platform: 'macos' };
  const first = await status(kit.as(undefined, 'POST', '/api/members/claim', claim));

  expect({
    invite: { ...invite, code: '<code>', inviteUri: invite.inviteUri.replace(invite.code, '<code>'), member: { ...invite.member, memberId: '<id>' } },
    first,
    again: await kit.as(undefined, 'POST', '/api/members/claim', claim),
    writeOnSharedFolder: await kit.chat.host.call('POST', '/api/members/invites', {
      name: 'Writer',
      access: { kind: 'scoped', agents: [{ agentId: teamId, canEdit: false, workspace: 'workspace-write' }] },
      url: URL_FOR_MEMBERS,
    }),
    noAgents: (await kit.chat.host.call('POST', '/api/members/invites', { name: 'Nobody', access: { kind: 'scoped', agents: [] }, url: URL_FOR_MEMBERS })).status,
    withoutUrl: await kit.chat.host.call('POST', '/api/members/invites', { name: 'Guest', access: { kind: 'co-owner' } }),
  }).toMatchInlineSnapshot(`
    {
      "again": {
        "body": {
          "error": {
            "kind": "unauthorized",
            "message": "This invite is wrong, used, expired or revoked. Ask for a new one.",
          },
        },
        "status": 401,
      },
      "first": 201,
      "invite": {
        "code": "<code>",
        "inviteUri": "oribot://join?url=https%3A%2F%2Fstudio.example.ts.net&code=<code>",
        "member": {
          "access": {
            "kind": "co-owner",
          },
          "createdAt": "2026-01-01T00:00:01.000Z",
          "memberId": "<id>",
          "name": "Guest",
          "status": {
            "expiresAt": "2026-01-08T00:00:01.000Z",
            "kind": "invited",
          },
        },
        "url": "https://studio.example.ts.net",
      },
      "noAgents": 400,
      "withoutUrl": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Set ORIBOT_HOST_BIND to a LAN or Tailscale address, or send the url members should use",
          },
        },
        "status": 409,
      },
      "writeOnSharedFolder": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "Writing is allowed only for an agent with its own dedicated folder; share this one read-only",
          },
        },
        "status": 400,
      },
    }
  `);
});
