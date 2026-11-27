import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MessageList, SendMessageResponse, type Thread } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_PLUGIN_TIMEOUTS } from './features/plugins/index.ts';
import { ECHO, hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture | undefined;
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
});

async function start(fixture: ChatFixture, thread: Thread, text: string): Promise<string> {
  const reply = await fixture.host.call('POST', `/api/threads/${thread.id}/messages`, { text });
  return SendMessageResponse.parse(reply.body).generationId;
}

it('refuses an access level the provider withholds, with its reason, and writes nothing', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent({ ...ECHO, access: 'workspace-write' });
  const thread = await chat.thread(agent);
  const reply = await chat.send(thread, 'hi');
  expect({ reply, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [],
      "reply": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Echo only reads.",
          },
        },
        "status": 409,
      },
    }
  `);
});

it('refuses a send whose route-info times out, and writes nothing', async () => {
  chat = await startChatFixture({ timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, routeInfoMs: 100 } });
  await chat.configure({ sessions: true, routeInfo: 'hang' });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const reply = await chat.send(thread, 'hi');
  expect({ reply, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [],
      "reply": {
        "body": {
          "error": {
            "kind": "provider-unavailable",
            "message": "The provider took too long to say which account it uses. Try again.",
            "reason": "route-info-timeout",
          },
        },
        "status": 503,
      },
    }
  `);
});

it('fails a queued turn whose agent was unbound meanwhile, sends nothing, and Continue then works', async () => {
  chat = await startChatFixture();
  const busy = await chat.agent();
  const one = await chat.thread(busy, 'One');
  const two = await chat.thread(busy, 'Two');
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await start(chat, one, 'stall-polite');
  const second = await start(chat, two, 'stall-polite');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === second);
  const queued = await start(chat, thread, 'queued while unbound');
  await chat.host.call('PATCH', `/api/agents/${agent.id}`, { provider: { kind: 'unbound' } });
  await chat.host.call('POST', `/api/threads/${one.id}/stop`);
  await chat.events.finished(queued);
  await chat.host.call('PATCH', `/api/agents/${agent.id}`, { provider: ECHO });
  const { messages } = MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body);
  const failedMessageId = messages.at(-1)?.id ?? '';
  const continued = await chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId });
  await chat.events.until((event) => event.kind === 'generation.finished' && event.threadId === thread.id && event.generationId !== queued);
  await chat.host.call('POST', `/api/threads/${two.id}/stop`);
  expect({ continued: continued.status, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "continued": 202,
      "history": [
        "user: queued while unbound",
        "assistant(failed binding-changed): ",
        "assistant(completed): hello from pid <pid>: queued while unbound",
      ],
    }
  `);
});

it('reads AGENTS.md at dispatch: a queued stateless turn gets the new text, a queued resume is refused', async () => {
  chat = await startChatFixture();
  const busy = await chat.agent();
  const one = await chat.thread(busy, 'One');
  const two = await chat.thread(busy, 'Two');
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await start(chat, one, 'stall-polite');
  const second = await start(chat, two, 'stall-polite');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === second);
  const queued = await start(chat, thread, 'describe');
  await writeFile(path.join(agent.workspace.dir, 'AGENTS.md'), 'Edited while queued.');
  await chat.host.call('POST', `/api/threads/${one.id}/stop`);
  await chat.events.finished(queued);
  await chat.host.call('POST', `/api/threads/${two.id}/stop`);
  expect((await chat.history(thread)).at(-1)).toMatchInlineSnapshot(`"assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":null},"system":"Edited while queued.","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}"`);
});

it('fails a queued resume at dispatch when AGENTS.md changed, sending nothing', async () => {
  chat = await startChatFixture();
  await chat.configure({ sessions: true });
  const busy = await chat.agent();
  const one = await chat.thread(busy, 'One');
  const two = await chat.thread(busy, 'Two');
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'bind');
  await start(chat, one, 'stall-polite');
  const second = await start(chat, two, 'stall-polite');
  await chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === second);
  const queued = await start(chat, thread, 'describe');
  await writeFile(path.join(agent.workspace.dir, 'AGENTS.md'), 'Edited while queued.');
  await chat.host.call('POST', `/api/threads/${one.id}/stop`);
  await chat.events.finished(queued);
  await chat.host.call('POST', `/api/threads/${two.id}/stop`);
  expect((await chat.history(thread)).slice(-2)).toMatchInlineSnapshot(`
    [
      "user: describe",
      "assistant(failed instructions-changed): ",
    ]
  `);
});

it('drops the oldest messages from an oversized seed and marks the reply', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  for (const letter of ['a', 'b']) await chat.send(thread, letter.repeat(90_000));
  await chat.send(thread, 'last');
  const { messages } = MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body);
  expect(messages.map((message) => ({ kind: message.kind, bytes: hidePid(message.text).length, truncated: message.kind === 'assistant' ? (message.seedTruncated ?? false) : null }))).toMatchInlineSnapshot(`
    [
      {
        "bytes": 90000,
        "kind": "user",
        "truncated": null,
      },
      {
        "bytes": 90022,
        "kind": "assistant",
        "truncated": false,
      },
      {
        "bytes": 90000,
        "kind": "user",
        "truncated": null,
      },
      {
        "bytes": 90022,
        "kind": "assistant",
        "truncated": false,
      },
      {
        "bytes": 4,
        "kind": "user",
        "truncated": null,
      },
      {
        "bytes": 26,
        "kind": "assistant",
        "truncated": true,
      },
    ]
  `);
});

it('cuts a new seeded session to its last 20 messages and marks the reply', async () => {
  chat = await startChatFixture();
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  for (let index = 0; index < 11; index += 1) await chat.send(thread, `m${String(index)}`);
  await chat.configure({ sessions: true });
  const reply = await chat.send(thread, 'describe', { kind: 'new-seeded' });
  const { messages } = MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body);
  const last = messages.at(-1);
  const seed = last?.text.match(/<user>\\nm(\d+)/);
  expect({ status: reply.status, truncated: last?.kind === 'assistant' ? last.seedTruncated : null, firstSeeded: seed?.[1] }).toMatchInlineSnapshot(`
    {
      "firstSeeded": "1",
      "status": 202,
      "truncated": true,
    }
  `);
});
