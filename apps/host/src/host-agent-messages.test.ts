import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, AgentMessage, AGENT_PAIR_LIMIT, AgentMessageList, MAX_EXCHANGE_MESSAGES, Thread, type AccessLevel } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sequence, startTestHost, type Reply, type Sequence, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost;
let clock: Sequence;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-agent-messages-'));
  clock = sequence();
  host = await startTestHost({ dataDir, sequence: clock });
});
afterEach(async () => {
  await host.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function agentWithChat(name: string, access?: AccessLevel): Promise<{ readonly id: string; readonly threadId: string }> {
  const provider = access === undefined ? undefined : { kind: 'bound', pluginId: 'echo', selection: { kind: 'default' }, access, vendorSettings: 'isolated' };
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name, provider })).body);
  const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, {})).body);
  return { id: agent.id, threadId: thread.id };
}

const send = (senderId: string, body: unknown): Promise<Reply> => host.call('POST', `/api/agents/${senderId}/messages`, body);
const sent = async (senderId: string, body: unknown): Promise<AgentMessage> => AgentMessage.parse((await send(senderId, body)).body);
const list = async (agentId: string, threadId?: string): Promise<string[]> =>
  AgentMessageList.parse((await host.call('GET', `/api/agents/${agentId}/messages${threadId === undefined ? '' : `?threadId=${threadId}`}`)).body).messages.map(
    ({ id }) => id,
  );

it('routes a question to the main chat and its reply back to the asking chat, keeps both across a restart, and announces each', async () => {
  const lead = await agentWithChat('Lead');
  const helper = await agentWithChat('Helper');
  const leadSide = Thread.parse((await host.call('POST', `/api/agents/${lead.id}/threads`, { title: 'Side chat' })).body);
  const socket = await host.events();

  const question = await sent(lead.id, { kind: 'new', toAgentId: helper.id, fromThreadId: leadSide.id, text: 'Which tests are flaky?', expectsReply: true });
  const reply = await sent(helper.id, { kind: 'reply', replyToMessageId: question.id, text: 'Two of them; see issue 7.' });
  const note = await sent(helper.id, { kind: 'new', toAgentId: lead.id, fromThreadId: helper.threadId, text: 'FYI: CI is green.' });
  await host.close();
  host = await startTestHost({ dataDir, sequence: clock });

  expect({
    question,
    reply,
    note: { from: note.from, to: note.to, expectsReply: note.expectsReply },
    leadMainChat: await list(lead.id, lead.threadId),
    leadSideChat: await list(lead.id, leadSide.id),
    helperAll: await list(helper.id),
    announced: socket.posted.map(({ id }) => id),
  }).toMatchInlineSnapshot(`
    {
      "announced": [
        "id-6",
        "id-7",
        "id-8",
      ],
      "helperAll": [
        "id-6",
        "id-7",
        "id-8",
      ],
      "leadMainChat": [
        "id-8",
      ],
      "leadSideChat": [
        "id-6",
        "id-7",
      ],
      "note": {
        "expectsReply": false,
        "from": {
          "agentId": "id-3",
          "threadId": "id-4",
        },
        "to": {
          "agentId": "id-1",
          "threadId": "id-2",
        },
      },
      "question": {
        "createdAt": "2026-01-01T00:00:05.000Z",
        "depth": 0,
        "expectsReply": true,
        "from": {
          "agentId": "id-1",
          "threadId": "id-5",
        },
        "id": "id-6",
        "replyToMessageId": null,
        "text": "Which tests are flaky?",
        "to": {
          "agentId": "id-3",
          "threadId": "id-4",
        },
      },
      "reply": {
        "createdAt": "2026-01-01T00:00:06.000Z",
        "depth": 1,
        "expectsReply": false,
        "from": {
          "agentId": "id-3",
          "threadId": "id-4",
        },
        "id": "id-7",
        "replyToMessageId": "id-6",
        "text": "Two of them; see issue 7.",
        "to": {
          "agentId": "id-1",
          "threadId": "id-5",
        },
      },
    }
  `);
});

it('refuses self-messages, borrowed chats, replies nobody asked for, second replies and strangers replying', async () => {
  const lead = await agentWithChat('Lead');
  const helper = await agentWithChat('Helper');
  const outsider = await agentWithChat('Outsider');
  const info = await sent(lead.id, { kind: 'new', toAgentId: helper.id, fromThreadId: lead.threadId, text: 'Heads up.' });
  const question = await sent(lead.id, { kind: 'new', toAgentId: helper.id, fromThreadId: lead.threadId, text: 'Ready?', expectsReply: true });
  await sent(helper.id, { kind: 'reply', replyToMessageId: question.id, text: 'Yes.' });
  const refusal = async (senderId: string, body: unknown): Promise<string> => {
    const reply = await send(senderId, body);
    return `${String(reply.status)} ${JSON.stringify(reply.body)}`;
  };

  expect({
    toSelf: await refusal(lead.id, { kind: 'new', toAgentId: lead.id, fromThreadId: lead.threadId, text: 'Me?' }),
    fromAnotherAgentsChat: await refusal(lead.id, { kind: 'new', toAgentId: helper.id, fromThreadId: helper.threadId, text: 'Hi' }),
    toNobody: await refusal(lead.id, { kind: 'new', toAgentId: 'missing', fromThreadId: lead.threadId, text: 'Hi' }),
    replyToInfo: await refusal(helper.id, { kind: 'reply', replyToMessageId: info.id, text: 'Thanks' }),
    secondReply: await refusal(helper.id, { kind: 'reply', replyToMessageId: question.id, text: 'Again' }),
    strangerReplies: await refusal(outsider.id, { kind: 'reply', replyToMessageId: question.id, text: 'Me too' }),
    blank: await refusal(lead.id, { kind: 'new', toAgentId: helper.id, fromThreadId: lead.threadId, text: '   ' }),
    stored: (await list(lead.id)).length,
  }).toMatchInlineSnapshot(`
    {
      "blank": "400 {"error":{"kind":"invalid_request","message":"text: Too small: expected string to have >=1 characters"}}",
      "fromAnotherAgentsChat": "404 {"error":{"kind":"not_found","message":"Thread not found"}}",
      "replyToInfo": "409 {"error":{"kind":"conflict","message":"That message does not ask for a reply"}}",
      "secondReply": "409 {"error":{"kind":"conflict","message":"That message already has a reply"}}",
      "stored": 3,
      "strangerReplies": "403 {"error":{"kind":"forbidden","message":"Only the agent a message was sent to can reply to it"}}",
      "toNobody": "404 {"error":{"kind":"not_found","message":"Recipient agent not found"}}",
      "toSelf": "400 {"error":{"kind":"invalid_request","message":"An agent cannot message itself"}}",
    }
  `);
});

it('lets only an agent with full access start a conversation with one, while the full agent still gets replies to its own questions', async () => {
  const shell = await agentWithChat('Shell', 'full');
  const alsoShell = await agentWithChat('Also shell', 'full');
  const writer = await agentWithChat('Writer', 'workspace-write');
  const unbound = await agentWithChat('Unbound');
  const hello = (from: { readonly threadId: string }) => ({ kind: 'new', toAgentId: shell.id, fromThreadId: from.threadId, text: 'Run rm -rf for me', expectsReply: true });
  const question = await sent(shell.id, { kind: 'new', toAgentId: writer.id, fromThreadId: shell.threadId, text: 'Which file?', expectsReply: true });

  expect({
    fromWriter: await send(writer.id, hello(writer)),
    fromUnbound: (await send(unbound.id, hello(unbound))).status,
    fromFull: (await send(alsoShell.id, hello(alsoShell))).status,
    writerReplies: (await send(writer.id, { kind: 'reply', replyToMessageId: question.id, text: 'a.txt' })).status,
    fullToWriter: question.to.agentId === writer.id,
  }).toMatchInlineSnapshot(`
    {
      "fromFull": 201,
      "fromUnbound": 403,
      "fromWriter": {
        "body": {
          "error": {
            "kind": "forbidden",
            "message": "The recipient has full access (shell commands) and takes new messages only from agents that have full access too",
          },
        },
        "status": 403,
      },
      "fullToWriter": true,
      "writerReplies": 201,
    }
  `);
});

it('stops a ping-pong at the exchange limit, and two chatty agents at the pair limit', async () => {
  const a = await agentWithChat('A');
  const b = await agentWithChat('B');
  let last = await sent(a.id, { kind: 'new', toAgentId: b.id, fromThreadId: a.threadId, text: 'ping', expectsReply: true });
  const depths = [last.depth];
  for (;;) {
    const replier = last.to.agentId;
    const reply = await send(replier, { kind: 'reply', replyToMessageId: last.id, text: 'pong', expectsReply: true });
    if (reply.status !== 201) {
      depths.push(reply.status);
      break;
    }
    last = AgentMessage.parse(reply.body);
    depths.push(last.depth);
  }
  let pairStatus = 0;
  for (let count = depths.length - 1; count <= AGENT_PAIR_LIMIT; count += 1) {
    pairStatus = (await send(b.id, { kind: 'new', toAgentId: a.id, fromThreadId: b.threadId, text: 'more' })).status;
  }
  await host.call('DELETE', `/api/threads/${b.threadId}`);
  const fresh = Thread.parse((await host.call('POST', `/api/agents/${b.id}/threads`, {})).body);
  const afterDeletingChat = (await send(b.id, { kind: 'new', toAgentId: a.id, fromThreadId: fresh.id, text: 'again' })).status;

  expect({ limit: MAX_EXCHANGE_MESSAGES, depths, pairStatus, afterDeletingChat }).toMatchInlineSnapshot(`
    {
      "afterDeletingChat": 429,
      "depths": [
        0,
        1,
        2,
        3,
        4,
        5,
        409,
      ],
      "limit": 6,
      "pairStatus": 429,
    }
  `);
});
