import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, AgentMessage, AgentMessageList, MemoryList, type ChatEvent, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ECHO, hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { postMcp, savedTools } from './testing/host-tools-client.ts';
import { sequence } from './testing/test-host.ts';

let dataDir: string;
let chat: ChatFixture;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-agent-tools-')));
  chat = await startChatFixture({ dataDir, sequence: sequence() });
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

async function agentWithChat(name: string): Promise<{ readonly agent: Agent; readonly thread: Thread }> {
  const agent = Agent.parse((await chat.host.call('POST', '/api/agents', { name, description: `${name} agent`, provider: ECHO })).body);
  return { agent, thread: await chat.thread(agent) };
}

/** One echo turn line that calls a MorrowBot tool. */
const call = (name: string, args: object): string => `host-tool ${name} ${JSON.stringify(args)}`;

/** The reply's lines, one per tool call. */
async function lastReply(thread: Thread): Promise<string[]> {
  const history = await chat.history(thread);
  return (history.at(-1) ?? '').replace(/^assistant\(completed\): /, '').split('\n');
}

const exchanged = async (agentId: string, threadId: string): Promise<string[]> =>
  AgentMessageList.parse((await chat.host.call('GET', `/api/agents/${agentId}/messages?threadId=${threadId}`)).body).messages.map(
    (message) =>
      `${message.id} ${message.from.agentId} -> ${message.to.agentId}${message.replyToMessageId === null ? '' : ` (reply to ${message.replyToMessageId})`}${message.expectsReply ? ' expects reply' : ''}`,
  );

const backgroundFinished = (threadId: string) => (event: ChatEvent) => event.kind === 'generation.background-finished' && event.threadId === threadId;


it('sends a message as the turn’s own agent: the recipient reads it in a silent background turn and its answer comes back', async () => {
  const lead = await agentWithChat('Lead');
  const helper = await agentWithChat('Helper');
  await chat.send(lead.thread, [call('list_agents', {}), call('send_message', { recipientAgentIds: [helper.agent.id], text: 'Which tests are flaky?' })].join('\n'));
  await chat.events.until(backgroundFinished(lead.thread.id));

  expect({
    leadReply: (await lastReply(lead.thread)).map(hidePid),
    exchange: await exchanged(lead.agent.id, lead.thread.id),
    helperHistory: await chat.history(helper.thread),
    helperEvents: chat.events.received.filter((event) => event.kind !== 'usage.updated' && event.kind !== 'generation.delta' && event.threadId === helper.thread.id).map(({ kind }) => kind),
  }).toMatchInlineSnapshot(`
    {
      "exchange": [
        "id-7 id-1 -> id-3 expects reply",
        "id-10 id-3 -> id-1 (reply to id-7)",
      ],
      "helperEvents": [
        "generation.background-started",
        "generation.status",
        "generation.background-finished",
      ],
      "helperHistory": [],
      "leadReply": [
        "list_agents: {"you":{"id":"id-1","name":"Lead"},"agents":[{"id":"id-3","name":"Helper","description":"Helper agent"}]}",
        "send_message: {"sent":[{"messageId":"id-7","toAgentId":"id-3"}],"notSent":[]}",
      ],
    }
  `);
});

it('cannot send as another agent, reply to a message sent to someone else, or act once its turn has ended', async () => {
  const lead = await agentWithChat('Lead');
  const helper = await agentWithChat('Helper');
  const other = await agentWithChat('Other');
  const asked = await chat.host.call('POST', `/api/agents/${other.agent.id}/messages`, {
    kind: 'new',
    toAgentId: helper.agent.id,
    fromThreadId: other.thread.id,
    text: 'For the helper only',
    expectsReply: true,
  });
  const askedId = AgentMessage.parse(asked.body).id;
  await chat.events.until(backgroundFinished(other.thread.id));
  await chat.send(
    lead.thread,
    [
      call('send_message', { recipientAgentIds: [helper.agent.id], text: 'Spoofed', fromAgentId: other.agent.id }),
      call('send_message', { recipientAgentIds: [other.agent.id], text: 'Hijacked reply', replyToMessageId: askedId }),
      call('send_message', { recipientAgentIds: [lead.agent.id], text: 'Talking to myself' }),
    ].join('\n'),
  );
  const ended = await savedTools(dataDir);
  const late = ended.kind === 'mcp' ? await postMcp(ended.url, ended.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }) : null;

  expect({ leadReply: (await lastReply(lead.thread)).map(hidePid), afterTheTurn: late, helperExchange: await exchanged(helper.agent.id, helper.thread.id) })
    .toMatchInlineSnapshot(`
      {
        "afterTheTurn": {
          "body": {
            "error": "This token is unknown, or its turn has ended",
          },
          "status": 401,
        },
        "helperExchange": [
          "id-7 id-5 -> id-3 expects reply",
          "id-9 id-3 -> id-5 (reply to id-7)",
        ],
        "leadReply": [
          "send_message: error ✖ Unrecognized key: "fromAgentId"",
          "send_message: error Only the agent a message was sent to can reply to it",
          "send_message: error id-1: An agent cannot message itself",
        ],
      }
    `);
});

it('asks a follow-up from a background turn instead of ending the exchange', async () => {
  const lead = await agentWithChat('Lead');
  const helper = await agentWithChat('Helper');
  const followUp = call('send_message', { recipientAgentIds: [lead.agent.id], replyToMessageId: '{{message}}', text: 'Which suite?', expectsReply: true });
  await chat.send(lead.thread, call('send_message', { recipientAgentIds: [helper.agent.id], text: followUp }));
  await vi.waitFor(() => {
    expect(chat.events.received.filter(backgroundFinished(helper.thread.id))).toHaveLength(2);
  });

  expect({
    exchange: await exchanged(lead.agent.id, lead.thread.id),
    helperHistory: await chat.history(helper.thread),
    leadHistory: (await chat.history(lead.thread)).map(hidePid),
  }).toMatchInlineSnapshot(`
    {
      "exchange": [
        "id-7 id-1 -> id-3 expects reply",
        "id-10 id-3 -> id-1 (reply to id-7) expects reply",
        "id-12 id-1 -> id-3 (reply to id-10)",
      ],
      "helperHistory": [],
      "leadHistory": [
        "user: host-tool send_message {"recipientAgentIds":["id-3"],"text":"host-tool send_message {\\"recipientAgentIds\\":[\\"id-1\\"],\\"replyToMessageId\\":\\"{{message}}\\",\\"text\\":\\"Which suite?\\",\\"expectsReply\\":true}"}",
        "assistant(completed): send_message: {"sent":[{"messageId":"id-7","toAgentId":"id-3"}],"notSent":[]}",
      ],
    }
  `);
});

it('remembers, searches, updates and forgets only the turn’s own agent’s memories', async () => {
  const keeper = await agentWithChat('Keeper');
  const stranger = await agentWithChat('Stranger');
  await chat.send(
    keeper.thread,
    [call('remember', { text: 'The deploy key lives in the vault' }), call('remember', { text: 'Standup is at nine', inclusion: 'essential' })].join('\n'),
  );
  const saved = MemoryList.parse((await chat.host.call('GET', `/api/agents/${keeper.agent.id}/memories`)).body).memories;
  const [deployKey, standup] = saved.map(({ id }) => id);
  await chat.send(
    keeper.thread,
    [
      call('search_memories', { query: 'deploy vault' }),
      call('remember', { memoryId: standup, text: 'Standup moved to ten' }),
      call('forget_memory', { memoryId: deployKey }),
      call('search_memories', { query: 'deploy' }),
    ].join('\n'),
  );
  const keeperReply = await lastReply(keeper.thread);
  await chat.send(stranger.thread, [call('search_memories', { query: 'standup' }), call('forget_memory', { memoryId: standup }), call('remember', { memoryId: standup, text: 'Mine now' })].join('\n'));

  expect({
    keeperReply: keeperReply.map(hidePid),
    strangerReply: (await lastReply(stranger.thread)).map(hidePid),
    keeperMemories: MemoryList.parse((await chat.host.call('GET', `/api/agents/${keeper.agent.id}/memories`)).body).memories.map(({ inclusion, text }) => `${inclusion}: ${text}`),
  }).toMatchInlineSnapshot(`
    {
      "keeperMemories": [
        "essential: Standup moved to ten",
      ],
      "keeperReply": [
        "search_memories: {"memories":[{"id":"id-7","inclusion":"searchable","text":"The deploy key lives in the vault","updatedAt":"2026-01-01T00:00:06.000Z"}]}",
        "remember: {"memory":{"id":"id-8","inclusion":"essential","text":"Standup moved to ten","updatedAt":"2026-01-01T00:00:11.000Z"}}",
        "forget_memory: {"forgotten":"id-7"}",
        "search_memories: {"memories":[]}",
      ],
      "strangerReply": [
        "search_memories: {"memories":[]}",
        "forget_memory: error You have no memory id-8",
        "remember: error You have no memory id-8",
      ],
    }
  `);
});
