import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, AgentInstructionsView, AgentMessage, mainThread, StartedSend, Thread, ThreadList } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ECHO, hidePid } from './testing/chat-fixture.ts';
import { PLUGIN_FIXTURES, sequence, startTestHost, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-api-')));
});
afterEach(async () => {
  await host?.close();
  host = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

/** An occupied entry's revision, checked to be there, as a stable placeholder. */
function withoutRevision(body: unknown): unknown {
  const view = AgentInstructionsView.parse(body);
  expect(view.revision).not.toBeNull();
  return { ...view, revision: '<revision>' };
}

function redact(value: unknown): unknown {
  const redacted: unknown = JSON.parse(hidePid(JSON.stringify(value).replaceAll(dataDir, '<data>')));
  return redacted;
}

it('keeps agents, threads, messages and SOUL.md across a host restart', async () => {
  const ids = sequence();
  const first = await startTestHost({ dataDir, pluginsDir: PLUGIN_FIXTURES, sequence: ids });
  const agent = Agent.parse(
    (await first.call('POST', '/api/agents', { name: 'Keeper', provider: ECHO }))
      .body,
  );
  await first.call('PUT', `/api/agents/${agent.id}/instructions`, { content: '# Keeper\nRemember.', expectedRevision: null });
  const thread = Thread.parse((await first.call('POST', `/api/agents/${agent.id}/threads`, {})).body);
  const events = await first.events();
  await events.watch(thread.id);
  const sent = StartedSend.parse((await first.call('POST', `/api/threads/${thread.id}/messages`, { text: 'remember me' })).body);
  await events.finished(sent.generationId);
  await first.close();

  host = await startTestHost({ dataDir, pluginsDir: PLUGIN_FIXTURES, sequence: ids });
  expect(
    redact({
      agents: (await host.call('GET', '/api/agents')).body,
      instructions: withoutRevision((await host.call('GET', `/api/agents/${agent.id}/instructions`)).body),
      threads: (await host.call('GET', `/api/agents/${agent.id}/threads`)).body,
      messages: (await host.call('GET', `/api/threads/${thread.id}/messages`)).body,
    }),
  ).toMatchInlineSnapshot(`
    {
      "agents": {
        "agents": [
          {
            "avatar": {
              "color": "#6b7280",
              "finish": "flat",
              "kind": "bot",
              "shape": "chat",
            },
            "createdAt": "2026-01-01T00:00:00.000Z",
            "description": "",
            "disabledExtensions": [],
            "emojiReplies": "allowed",
            "folderId": null,
            "id": "id-1",
            "name": "Keeper",
            "provider": {
              "access": "read-only",
              "kind": "bound",
              "pluginId": "echo",
              "selection": {
                "kind": "default",
              },
              "vendorSettings": "isolated",
            },
            "revision": 0,
            "updatedAt": "2026-01-01T00:00:00.000Z",
            "workspace": {
              "dir": "<data>/workspaces/id-1",
              "kind": "dedicated",
            },
          },
        ],
        "folders": [],
        "lastMessages": [
          {
            "agentId": "id-1",
            "at": "2026-01-01T00:00:04.000Z",
            "kind": "assistant",
            "preview": "hello from pid <pid>: remember me",
            "threadId": "id-2",
          },
        ],
      },
      "instructions": {
        "canReplace": false,
        "content": "# Keeper
    Remember.",
        "revision": "<revision>",
      },
      "messages": {
        "messages": [
          {
            "attachments": [],
            "createdAt": "2026-01-01T00:00:02.000Z",
            "id": "id-4",
            "kind": "user",
            "text": "remember me",
            "threadId": "id-2",
          },
          {
            "attachments": [],
            "createdAt": "2026-01-01T00:00:04.000Z",
            "id": "id-5",
            "kind": "assistant",
            "outcome": {
              "finishReason": "stop",
              "kind": "completed",
            },
            "text": "hello from pid <pid>: remember me",
            "threadId": "id-2",
          },
        ],
      },
      "threads": {
        "threads": [
          {
            "agentId": "id-1",
            "archivedAt": null,
            "createdAt": "2026-01-01T00:00:01.000Z",
            "createdSeq": 1,
            "id": "id-2",
            "title": "New chat",
            "updatedAt": "2026-01-01T00:00:04.000Z",
          },
        ],
      },
    }
  `);
});

it('creates, updates and deletes agents and threads', async () => {
  host = await startTestHost({ dataDir });
  const shared = path.join(dataDir, 'team');
  const dedicated = Agent.parse((await host.call('POST', '/api/agents', { name: 'Solo', description: 'Own folder' })).body);
  const sharing = Agent.parse(
    (await host.call('POST', '/api/agents', { name: 'Pair', workspace: { kind: 'shared', dir: shared } })).body,
  );
  await access(dedicated.workspace.dir);
  await access(shared);
  const thread = Thread.parse((await host.call('POST', `/api/agents/${sharing.id}/threads`, { title: 'Old' })).body);

  const steps = {
    renamedAgent: await host.call('PATCH', `/api/agents/${dedicated.id}`, {
      name: 'Solo 2',
      provider: { ...ECHO, selection: { kind: 'model', id: 'big', choices: {} } },
    }),
    renamedThread: await host.call('PATCH', `/api/threads/${thread.id}`, { title: 'New' }),
    missingInstructions: await host.call('GET', `/api/agents/${sharing.id}/instructions`),
    deleteAgent: await host.call('DELETE', `/api/agents/${sharing.id}`),
    threadAfterAgentDeleted: await host.call('GET', `/api/threads/${thread.id}`),
    deleteAgain: await host.call('DELETE', `/api/agents/${sharing.id}`),
    agents: await host.call('GET', '/api/agents'),
  };
  expect(redact(steps)).toMatchInlineSnapshot(`
    {
      "agents": {
        "body": {
          "agents": [
            {
              "avatar": {
                "color": "#6b7280",
                "finish": "flat",
                "kind": "bot",
                "shape": "chat",
              },
              "createdAt": "2026-01-01T00:00:00.000Z",
              "description": "Own folder",
              "disabledExtensions": [],
              "emojiReplies": "allowed",
              "folderId": null,
              "id": "id-1",
              "name": "Solo 2",
              "provider": {
                "access": "read-only",
                "kind": "bound",
                "pluginId": "echo",
                "selection": {
                  "choices": {},
                  "id": "big",
                  "kind": "model",
                },
                "vendorSettings": "isolated",
              },
              "revision": 1,
              "updatedAt": "2026-01-01T00:00:03.000Z",
              "workspace": {
                "dir": "<data>/workspaces/id-1",
                "kind": "dedicated",
              },
            },
          ],
          "folders": [],
          "lastMessages": [],
        },
        "status": 200,
      },
      "deleteAgain": {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Agent not found",
          },
        },
        "status": 404,
      },
      "deleteAgent": {
        "body": null,
        "status": 204,
      },
      "missingInstructions": {
        "body": {
          "canReplace": false,
          "content": null,
          "revision": null,
        },
        "status": 200,
      },
      "renamedAgent": {
        "body": {
          "avatar": {
            "color": "#6b7280",
            "finish": "flat",
            "kind": "bot",
            "shape": "chat",
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "description": "Own folder",
          "disabledExtensions": [],
          "emojiReplies": "allowed",
          "folderId": null,
          "id": "id-1",
          "name": "Solo 2",
          "provider": {
            "access": "read-only",
            "kind": "bound",
            "pluginId": "echo",
            "selection": {
              "choices": {},
              "id": "big",
              "kind": "model",
            },
            "vendorSettings": "isolated",
          },
          "revision": 1,
          "updatedAt": "2026-01-01T00:00:03.000Z",
          "workspace": {
            "dir": "<data>/workspaces/id-1",
            "kind": "dedicated",
          },
        },
        "status": 200,
      },
      "renamedThread": {
        "body": {
          "agentId": "id-2",
          "archivedAt": null,
          "createdAt": "2026-01-01T00:00:02.000Z",
          "createdSeq": 1,
          "id": "id-3",
          "title": "New",
          "updatedAt": "2026-01-01T00:00:04.000Z",
        },
        "status": 200,
      },
      "threadAfterAgentDeleted": {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Thread not found",
          },
        },
        "status": 404,
      },
    }
  `);
  await access(shared);
});

it('keeps the first-created chat as main when two chats share a creation millisecond and the second has a smaller id', async () => {
  const fixedNow = () => '2026-01-01T00:00:00.000Z';
  const ids = ['agent-receiver', 'z-first', 'a-second', 'agent-sender', 'sender-chat', 'msg-1'];
  let index = 0;
  host = await startTestHost({
    dataDir,
    sequence: {
      newId: () => ids[index++] ?? `extra-${String(index)}`,
      now: fixedNow,
    },
  });
  const receiver = Agent.parse((await host.call('POST', '/api/agents', { name: 'Receiver' })).body);
  const first = Thread.parse((await host.call('POST', `/api/agents/${receiver.id}/threads`, { title: 'First' })).body);
  const second = Thread.parse((await host.call('POST', `/api/agents/${receiver.id}/threads`, { title: 'Second' })).body);
  const sender = Agent.parse((await host.call('POST', '/api/agents', { name: 'Sender' })).body);
  const senderThread = Thread.parse((await host.call('POST', `/api/agents/${sender.id}/threads`, { title: 'Main' })).body);

  const listed = ThreadList.parse((await host.call('GET', `/api/agents/${receiver.id}/threads`)).body).threads;
  const sent = await host.call('POST', `/api/agents/${sender.id}/messages`, {
    kind: 'new',
    toAgentId: receiver.id,
    fromThreadId: senderThread.id,
    text: 'Hello main chat',
  });

  expect({
    createdIds: [first.id, second.id],
    createdSeqs: listed.map(({ id, createdSeq }) => ({ id, createdSeq })),
    mainFromReversed: mainThread([...listed].reverse())?.id,
    routedToThread: sent.status === 201 ? AgentMessage.parse(sent.body).to.threadId : sent.status,
  }).toMatchInlineSnapshot(`
    {
      "createdIds": [
        "z-first",
        "a-second",
      ],
      "createdSeqs": [
        {
          "createdSeq": 1,
          "id": "z-first",
        },
        {
          "createdSeq": 2,
          "id": "a-second",
        },
      ],
      "mainFromReversed": "z-first",
      "routedToThread": "z-first",
    }
  `);
});
