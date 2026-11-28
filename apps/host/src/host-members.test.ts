import { AgentList, ThreadList, StartedSend, type AgentGrant } from '@morrowbot/contracts';
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

it('shows a scoped member only its agents, keeps it out of other agents and server settings, and holds its turns to the grant', async () => {
  const shared = await kit.named('Shared');
  const editable = await kit.named('Editable');
  const writer = await kit.named('Writer', { ...ECHO, access: 'workspace-write' });
  const hidden = await kit.named('Hidden');
  const alsoHidden = await kit.named('Also hidden');
  const grant: Omit<AgentGrant, 'agentId'> = { canEdit: false, workspace: 'read-only', interAgentAllowlist: [] };
  const guest = await kit.join('Guest', {
    kind: 'scoped',
    agents: [
      { ...grant, agentId: shared.agent.id },
      { ...grant, agentId: editable.agent.id, canEdit: true },
      { ...grant, agentId: writer.agent.id },
    ],
  });
  const t = guest.token;
  const list = AgentList.parse((await kit.as(t, 'GET', '/api/agents')).body);
  const threads = ThreadList.parse((await kit.as(t, 'GET', '/api/threads')).body);
  const sendShared = await kit.as(t, 'POST', `/api/threads/${shared.thread.id}/messages`, { text: 'hello from a guest', sessionChoice: { kind: 'auto' } });
  const started = StartedSend.parse(sendShared.body);
  await kit.chat.events.finished(started.generationId);
  const { client: socket } = await kit.events(t);
  socket.subscribe(hidden.thread.id, null);
  const hiddenMessage = await kit.chat.host.call('POST', `/api/agents/${hidden.agent.id}/messages`, {
    kind: 'new',
    toAgentId: editable.agent.id,
    fromThreadId: hidden.thread.id,
    text: 'Owner agent says hi',
  });
  await kit.chat.host.call('POST', `/api/agents/${hidden.agent.id}/messages`, { kind: 'new', toAgentId: alsoHidden.agent.id, fromThreadId: hidden.thread.id, text: 'Not for you' });
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect({
    me: (await kit.as(t, 'GET', '/api/me')).body,
    agents: list.agents.map(({ name, folderId }) => ({ name, folderId })),
    folders: list.folders,
    threads: threads.threads.map(({ title }) => title),
    hiddenAgent: await kit.as(t, 'GET', `/api/agents/${hidden.agent.id}`),
    hidden: {
      threads: await status(kit.as(t, 'GET', `/api/agents/${hidden.agent.id}/threads`)),
      newThread: await status(kit.as(t, 'POST', `/api/agents/${hidden.agent.id}/threads`, {})),
      messages: await status(kit.as(t, 'GET', `/api/threads/${hidden.thread.id}/messages`)),
      send: await status(kit.as(t, 'POST', `/api/threads/${hidden.thread.id}/messages`, { text: 'hi', sessionChoice: { kind: 'auto' } })),
      instructions: await status(kit.as(t, 'GET', `/api/agents/${hidden.agent.id}/instructions`)),
      memories: await status(kit.as(t, 'GET', `/api/agents/${hidden.agent.id}/memories`)),
      agentMessages: await status(kit.as(t, 'GET', `/api/agents/${hidden.agent.id}/messages`)),
      subscribeAnswer: socket.resyncs,
    },
    serverSettings: {
      plugins: await status(kit.as(t, 'GET', '/api/plugins')),
      pluginConfig: await status(kit.as(t, 'PUT', '/api/plugins/echo/config', { config: {} })),
      usage: await status(kit.as(t, 'GET', '/api/usage/tokens?range=day')),
      routines: await status(kit.as(t, 'GET', '/api/routines')),
      newFolder: await status(kit.as(t, 'POST', '/api/folders', { name: 'Guests' })),
      createAgent: await status(kit.as(t, 'POST', '/api/agents', { name: 'Mine' })),
      deleteShared: await status(kit.as(t, 'DELETE', `/api/agents/${shared.agent.id}`)),
      members: await status(kit.as(t, 'GET', '/api/members')),
      pairing: await status(kit.as(t, 'GET', '/api/pairing/devices')),
      invite: await status(kit.as(t, 'POST', '/api/members/invites', { name: 'Friend', access: { kind: 'co-owner' }, url: URL_FOR_MEMBERS })),
    },
    edits: {
      renameWithoutEdit: await kit.as(t, 'PATCH', `/api/agents/${shared.agent.id}`, { name: 'Renamed' }),
      renameWithEdit: (await kit.as(t, 'PATCH', `/api/agents/${editable.agent.id}`, { name: 'Renamed' })).status,
      changeEngine: await kit.as(t, 'PATCH', `/api/agents/${editable.agent.id}`, { provider: { kind: 'unbound' } }),
      deleteChatWithoutEdit: await status(kit.as(t, 'DELETE', `/api/threads/${shared.thread.id}`)),
    },
    turns: {
      sharedSend: sendShared.status,
      sharedHistory: await kit.chat.history(shared.thread),
      writerSend: await kit.as(t, 'POST', `/api/threads/${writer.thread.id}/messages`, { text: 'write a file', sessionChoice: { kind: 'auto' } }),
    },
    eventsSeen: socket.posted.map(({ text }) => text),
    ownerMessageReached: hiddenMessage.status,
  }).toMatchInlineSnapshot(`
    {
      "agents": [
        {
          "folderId": null,
          "name": "Shared",
        },
        {
          "folderId": null,
          "name": "Editable",
        },
        {
          "folderId": null,
          "name": "Writer",
        },
      ],
      "edits": {
        "changeEngine": {
          "body": {
            "error": {
              "kind": "forbidden",
              "message": "Only the server owner may change an agent's engine or folder",
            },
          },
          "status": 403,
        },
        "deleteChatWithoutEdit": 403,
        "renameWithEdit": 200,
        "renameWithoutEdit": {
          "body": {
            "error": {
              "kind": "forbidden",
              "message": "Your invite does not let you change this agent",
            },
          },
          "status": 403,
        },
      },
      "eventsSeen": [
        "Owner agent says hi",
      ],
      "folders": [],
      "hidden": {
        "agentMessages": 404,
        "instructions": 404,
        "memories": 404,
        "messages": 404,
        "newThread": 404,
        "send": 404,
        "subscribeAnswer": [
          "id-8",
        ],
        "threads": 404,
      },
      "hiddenAgent": {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Agent not found",
          },
        },
        "status": 404,
      },
      "me": {
        "access": {
          "agents": [
            {
              "agentId": "id-1",
              "canEdit": false,
              "interAgentAllowlist": [],
              "workspace": "read-only",
            },
            {
              "agentId": "id-3",
              "canEdit": true,
              "interAgentAllowlist": [],
              "workspace": "read-only",
            },
            {
              "agentId": "id-5",
              "canEdit": false,
              "interAgentAllowlist": [],
              "workspace": "read-only",
            },
          ],
          "kind": "scoped",
        },
        "kind": "member",
        "memberId": "id-11",
        "name": "Guest",
      },
      "ownerMessageReached": 201,
      "serverSettings": {
        "createAgent": 403,
        "deleteShared": 403,
        "invite": 403,
        "members": 403,
        "newFolder": 403,
        "pairing": 403,
        "pluginConfig": 403,
        "plugins": 403,
        "routines": 403,
        "usage": 403,
      },
      "threads": [
        "Writer chat",
        "Editable chat",
        "Shared chat",
      ],
      "turns": {
        "sharedHistory": [
          "user: hello from a guest",
          "assistant(completed): hello from pid <pid>: hello from a guest",
        ],
        "sharedSend": 202,
        "writerSend": {
          "body": {
            "error": {
              "kind": "forbidden",
              "message": "This agent may write files, more than your invite allows. Ask the owner to share it read-only.",
            },
          },
          "status": 403,
        },
      },
    }
  `);
});

it('holds an agent shared with members to its inter-agent allowlist, whoever asks it to send', async () => {
  const shared = await kit.named('Shared');
  const helper = await kit.named('Helper');
  const other = await kit.named('Other');
  const guest = await kit.join('Guest', {
    kind: 'scoped',
    agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [helper.agent.id] }],
  });
  const message = (to: string) => ({ kind: 'new', toAgentId: to, fromThreadId: shared.thread.id, text: 'Can you help?' });

  expect({
    toAllowed: await status(kit.as(guest.token, 'POST', `/api/agents/${shared.agent.id}/messages`, message(helper.agent.id))),
    toOther: await kit.as(guest.token, 'POST', `/api/agents/${shared.agent.id}/messages`, message(other.agent.id)),
    ownerAsSharedToOther: await status(kit.chat.host.call('POST', `/api/agents/${shared.agent.id}/messages`, message(other.agent.id))),
    otherToShared: await status(
      kit.chat.host.call('POST', `/api/agents/${other.agent.id}/messages`, { kind: 'new', toAgentId: shared.agent.id, fromThreadId: other.thread.id, text: 'Hello' }),
    ),
    unsharedAgentToOther: await status(
      kit.chat.host.call('POST', `/api/agents/${helper.agent.id}/messages`, { kind: 'new', toAgentId: other.agent.id, fromThreadId: helper.thread.id, text: 'Hello' }),
    ),
  }).toMatchInlineSnapshot(`
    {
      "otherToShared": 201,
      "ownerAsSharedToOther": 403,
      "toAllowed": 201,
      "toOther": {
        "body": {
          "error": {
            "kind": "forbidden",
            "message": "This agent is shared with server members and may message only the agents its share allows",
          },
        },
        "status": 403,
      },
      "unsharedAgentToOther": 201,
    }
  `);
});
