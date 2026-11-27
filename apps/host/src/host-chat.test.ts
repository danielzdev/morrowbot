import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, type ChatProvider, SendMessageResponse, Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { startTestHost, type TestHost } from './testing/test-host.ts';

/** Replies with what it was given, and saves the last user message through the workspace tools. */
const echo: ChatProvider = {
  async *generate({ model, instructions, messages, tools }) {
    const last = messages.at(-1);
    yield { kind: 'text', text: `[${model}] instructions=${JSON.stringify(instructions)} ` };
    yield { kind: 'text', text: `history=${String(messages.length)} ` };
    const saved = await tools.run({ kind: 'write_file', path: 'last.txt', content: last?.text ?? '' });
    yield { kind: 'text', text: `saved=${saved.kind} echo=${last?.text ?? ''}` };
  },
};

/** Sends one chunk, then never finishes and ignores the abort signal. */
const stuck: ChatProvider = {
  async *generate() {
    yield { kind: 'text', text: 'partial' };
    await new Promise(() => undefined);
  },
};

let dataDir: string;
let host: TestHost;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-chat-'));
  host = await startTestHost({ dataDir, providers: { echo, stuck } });
});
afterEach(async () => {
  await host.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function agentWith(pluginId: string): Promise<Agent> {
  const created = await host.call('POST', '/api/agents', {
    name: 'Helper',
    provider: { kind: 'bound', pluginId, model: 'tiny' },
  });
  return Agent.parse(created.body);
}

async function threadOf(agent: Agent, title: string): Promise<Thread> {
  return Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title })).body);
}

it('streams a reply that follows AGENTS.md and saves it', async () => {
  const agent = await agentWith('echo');
  await host.call('PUT', `/api/agents/${agent.id}/instructions`, { content: 'Be brief.' });
  const thread = await threadOf(agent, 'Plans');
  const events = await host.events();

  const sent = await host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'hello' });
  expect(sent.status).toBe(202);
  await events.finished(thread.id);

  expect(events.received).toMatchInlineSnapshot(`
    [
      {
        "generationId": "id-5",
        "kind": "generation.started",
        "threadId": "id-3",
        "userMessage": {
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-4",
          "kind": "user",
          "text": "hello",
          "threadId": "id-3",
        },
      },
      {
        "generationId": "id-5",
        "kind": "generation.delta",
        "text": "[tiny] instructions="Be brief." ",
        "threadId": "id-3",
      },
      {
        "generationId": "id-5",
        "kind": "generation.delta",
        "text": "history=1 ",
        "threadId": "id-3",
      },
      {
        "call": {
          "content": "hello",
          "kind": "write_file",
          "path": "last.txt",
        },
        "generationId": "id-5",
        "kind": "generation.tool",
        "result": {
          "bytes": 5,
          "kind": "write_file",
        },
        "threadId": "id-3",
      },
      {
        "generationId": "id-5",
        "kind": "generation.delta",
        "text": "saved=write_file echo=hello",
        "threadId": "id-3",
      },
      {
        "generationId": "id-5",
        "kind": "generation.finished",
        "message": {
          "createdAt": "2026-01-01T00:00:04.000Z",
          "id": "id-6",
          "kind": "assistant",
          "outcome": {
            "kind": "completed",
          },
          "text": "[tiny] instructions="Be brief." history=1 saved=write_file echo=hello",
          "threadId": "id-3",
        },
        "threadId": "id-3",
      },
    ]
  `);
  expect((await host.call('GET', `/api/threads/${thread.id}/messages`)).body).toMatchInlineSnapshot(`
    {
      "messages": [
        {
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-4",
          "kind": "user",
          "text": "hello",
          "threadId": "id-3",
        },
        {
          "createdAt": "2026-01-01T00:00:04.000Z",
          "id": "id-6",
          "kind": "assistant",
          "outcome": {
            "kind": "completed",
          },
          "text": "[tiny] instructions="Be brief." history=1 saved=write_file echo=hello",
          "threadId": "id-3",
        },
      ],
    }
  `);
  expect(await readFile(path.join(agent.workspace.dir, 'AGENTS.md'), 'utf8')).toBe('Be brief.');
  expect(await readFile(path.join(agent.workspace.dir, 'last.txt'), 'utf8')).toBe('hello');
});

it('stops a generation even when the provider ignores the signal, and keeps the partial reply', async () => {
  const agent = await agentWith('stuck');
  const thread = await threadOf(agent, 'Long');
  const events = await host.events();

  const sent = SendMessageResponse.parse((await host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'go' })).body);
  await events.until((event) => event.kind === 'generation.delta' && event.generationId === sent.generationId);
  const busy = await host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'again' });
  const stopped = await host.call('POST', `/api/threads/${thread.id}/stop`);
  const idle = await host.call('POST', `/api/threads/${thread.id}/stop`);

  expect({ busy, stopped, idle }).toMatchInlineSnapshot(`
    {
      "busy": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "This thread is already generating a reply. Stop it first.",
          },
        },
        "status": 409,
      },
      "idle": {
        "body": {
          "kind": "idle",
        },
        "status": 200,
      },
      "stopped": {
        "body": {
          "kind": "stopped",
          "message": {
            "createdAt": "2026-01-01T00:00:04.000Z",
            "id": "id-5",
            "kind": "assistant",
            "outcome": {
              "kind": "stopped",
            },
            "text": "partial",
            "threadId": "id-2",
          },
        },
        "status": 200,
      },
    }
  `);
  expect(events.received.map((event) => event.kind)).toMatchInlineSnapshot(`
    [
      "generation.started",
      "generation.delta",
      "generation.finished",
    ]
  `);
  expect((await host.call('GET', `/api/threads/${thread.id}/messages`)).body).toMatchInlineSnapshot(`
    {
      "messages": [
        {
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-3",
          "kind": "user",
          "text": "go",
          "threadId": "id-2",
        },
        {
          "createdAt": "2026-01-01T00:00:04.000Z",
          "id": "id-5",
          "kind": "assistant",
          "outcome": {
            "kind": "stopped",
          },
          "text": "partial",
          "threadId": "id-2",
        },
      ],
    }
  `);
});

it('keeps each thread of an agent to its own history', async () => {
  const agent = await agentWith('echo');
  const first = await threadOf(agent, 'First');
  const second = await threadOf(agent, 'Second');
  const events = await host.events();

  for (const [thread, text] of [
    [first, 'one'],
    [second, 'two'],
    [first, 'three'],
  ] as const) {
    const sent = SendMessageResponse.parse((await host.call('POST', `/api/threads/${thread.id}/messages`, { text })).body);
    await events.until((event) => event.kind === 'generation.finished' && event.generationId === sent.generationId);
  }

  const history = async (thread: Thread) => {
    const reply = await host.call('GET', `/api/threads/${thread.id}/messages`);
    const parsed = z.object({ messages: z.array(z.object({ kind: z.string(), text: z.string() })) }).parse(reply.body);
    return parsed.messages.map((message) => `${message.kind}: ${message.text}`);
  };
  expect({ first: await history(first), second: await history(second) }).toMatchInlineSnapshot(`
    {
      "first": [
        "user: one",
        "assistant: [tiny] instructions="" history=1 saved=write_file echo=one",
        "user: three",
        "assistant: [tiny] instructions="" history=3 saved=write_file echo=three",
      ],
      "second": [
        "user: two",
        "assistant: [tiny] instructions="" history=1 saved=write_file echo=two",
      ],
    }
  `);
});

it('refuses to chat without a provider', async () => {
  const unbound = Agent.parse((await host.call('POST', '/api/agents', { name: 'Unbound' })).body);
  const missing = await agentWith('not-installed');
  const replies = [];
  for (const agent of [unbound, missing]) {
    const thread = await threadOf(agent, 'Chat');
    replies.push(await host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'hi' }));
  }
  replies.push(await host.call('POST', '/api/threads/nope/messages', { text: 'hi' }));
  expect(replies).toMatchInlineSnapshot(`
    [
      {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "This agent has no provider. Choose a provider and model first.",
          },
        },
        "status": 409,
      },
      {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Provider plugin not-installed is not available.",
          },
        },
        "status": 409,
      },
      {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Thread not found",
          },
        },
        "status": 404,
      },
    ]
  `);
});
