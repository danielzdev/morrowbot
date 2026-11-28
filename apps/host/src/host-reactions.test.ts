import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Agent,
  ChatSettings,
  MessageList,
  SetReactionResponse,
  StartedSend,
  ThreadState,
  type AgentEmojiReplies,
  type EmojiRepliesSetting,
  type Thread,
} from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ECHO, hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { sequence } from './testing/test-host.ts';

let dataDir: string;
let chat: ChatFixture;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-reactions-')));
  chat = await startChatFixture({ dataDir, sequence: sequence() });
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

async function agentWithChat(): Promise<{ readonly agent: Agent; readonly thread: Thread }> {
  const agent = Agent.parse((await chat.host.call('POST', '/api/agents', { name: 'Helper', provider: ECHO })).body);
  return { agent, thread: await chat.thread(agent) };
}

async function messages(thread: Thread) {
  return MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body).messages;
}

/** Sets the user's reaction; the status, and the message's emoji (by actor) or the error. */
async function react(thread: Thread, messageId: string, emoji: string, reacted: boolean): Promise<string> {
  const reply = await chat.host.call('PUT', `/api/threads/${thread.id}/reactions`, { messageId, emoji, reacted });
  const set = SetReactionResponse.safeParse(reply.body);
  return `${String(reply.status)} ${set.success ? set.data.reactions.map(({ actor, emoji: each }) => `${actor}:${each}`).join(' ') : JSON.stringify(reply.body)}`;
}

/** The kinds of a thread's events, in order, without the live text and usage. */
const kinds = (thread: Thread): string[] =>
  chat.events.received.filter((event) => event.kind !== 'usage.updated' && event.kind !== 'generation.delta' && event.threadId === thread.id).map(({ kind }) => kind);

/** Matches once `count` turns of the thread have ended, with or without a reply. */
const endedOn = (thread: Thread, count: number) => (): boolean =>
  chat.events.received.filter((each) => (each.kind === 'generation.finished' || each.kind === 'generation.background-finished') && each.threadId === thread.id).length >= count;

it('adds, keeps, removes and lists the user’s reactions on the agent’s replies, and refuses anything else', async () => {
  const { agent, thread } = await agentWithChat();
  await chat.send(thread, 'Hello');
  const [question, reply] = await messages(thread);
  await chat.host.call('PATCH', `/api/agents/${agent.id}`, { provider: { kind: 'unbound' } });
  const replyId = reply?.id ?? '';

  expect({
    steps: [
      await react(thread, replyId, '👍', true),
      await react(thread, replyId, '👍', true),
      await react(thread, replyId, '❤️', true),
      await react(thread, replyId, '👍', false),
      await react(thread, replyId, '👍', false),
      await react(thread, replyId, '🧑‍💻', true),
    ],
    refused: {
      ownMessage: await react(thread, question?.id ?? '', '👍', true),
      unknownMessage: await react(thread, 'missing', '👍', true),
      twoEmoji: await react(thread, replyId, '👍👍', true),
      text: await react(thread, replyId, 'ok', true),
      textForm: await react(thread, replyId, '❤', true),
    },
    state: ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body).reactions,
    events: kinds(thread),
  }).toMatchInlineSnapshot(`
    {
      "events": [
        "generation.started",
        "generation.status",
        "generation.finished",
        "reactions.changed",
        "reactions.changed",
        "reactions.changed",
        "reactions.changed",
      ],
      "refused": {
        "ownMessage": "409 {"error":{"kind":"conflict","message":"You can react to the agent’s replies only."}}",
        "text": "400 {"error":{"kind":"invalid_request","message":"emoji: Use one complete emoji, such as 👍 or ❤️"}}",
        "textForm": "400 {"error":{"kind":"invalid_request","message":"emoji: Use one complete emoji, such as 👍 or ❤️"}}",
        "twoEmoji": "400 {"error":{"kind":"invalid_request","message":"emoji: Use one complete emoji, such as 👍 or ❤️"}}",
        "unknownMessage": "404 {"error":{"kind":"not_found","message":"Message not found"}}",
      },
      "state": [
        {
          "actor": "user",
          "createdAt": "2026-01-01T00:00:08.000Z",
          "emoji": "❤️",
          "messageId": "id-5",
        },
        {
          "actor": "user",
          "createdAt": "2026-01-01T00:00:09.000Z",
          "emoji": "🧑‍💻",
          "messageId": "id-5",
        },
      ],
      "steps": [
        "200 user:👍",
        "200 user:👍",
        "200 user:👍 user:❤️",
        "200 user:❤️",
        "200 user:❤️",
        "200 user:❤️ user:🧑‍💻",
      ],
    }
  `);
});

it('lets the agent react to the user’s message and end its turn with no reply bubble and no reply event', async () => {
  const { thread } = await agentWithChat();
  const sent = await chat.send(thread, ['host-tool react_to_message {"emoji":"👍"}', 'host-tool stay_quiet {}'].join('\n'));
  const generationId = StartedSend.parse(sent.body).generationId;

  expect({
    history: (await messages(thread)).map(({ id, kind, text }) => `${id} ${kind}: ${text}`),
    reactions: ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body).reactions,
    turnEvents: chat.events.of(generationId).flatMap((event) => (typeof event === 'object' && event !== null && 'kind' in event ? [event.kind] : [])),
    threadEvents: kinds(thread),
  }).toMatchInlineSnapshot(`
    {
      "history": [
        "id-4 user: host-tool react_to_message {"emoji":"👍"}
    host-tool stay_quiet {}",
      ],
      "reactions": [
        {
          "actor": "agent",
          "createdAt": "2026-01-01T00:00:04.000Z",
          "emoji": "👍",
          "messageId": "id-4",
        },
      ],
      "threadEvents": [
        "generation.started",
        "generation.status",
        "reactions.changed",
        "generation.background-finished",
      ],
      "turnEvents": [
        "generation.started",
        "generation.status",
        "generation.delta",
        "generation.delta",
        "generation.background-finished",
      ],
    }
  `);
});

it('refuses a reaction that is not one complete emoji, and one in a turn that answers no message of the user’s', async () => {
  const { thread } = await agentWithChat();
  await chat.send(thread, ['host-tool react_to_message {"emoji":"thumbs up"}', 'host-tool react_to_message {"emoji":"👍👍"}'].join('\n'));
  await chat.send(thread, 'Ready? on-reaction react_to_message {"emoji":"🎉"}');
  const reply = (await messages(thread)).at(-1);
  await react(thread, reply?.id ?? '', '👍', true);
  await chat.events.until(endedOn(thread, 3));

  expect((await messages(thread)).filter(({ kind }) => kind === 'assistant').map(({ text }) => hidePid(text))).toMatchInlineSnapshot(`
    [
      "react_to_message: error ✖ Use one complete emoji, such as 👍 or ❤️
      → at emoji
    react_to_message: error ✖ Use one complete emoji, such as 👍 or ❤️
      → at emoji",
      "hello from pid <pid>: Ready? on-reaction react_to_message {"emoji":"🎉"}",
      "react_to_message: error This turn answers the user’s reaction, not a message: there is nothing to react to.",
    ]
  `);
});

it('tells the agent of the user’s reaction: it absorbs a thumbs-up quietly, or takes it as the go-ahead and replies', async () => {
  const { thread } = await agentWithChat();
  await chat.send(thread, 'Deployed. on-reaction stay_quiet {}');
  const [, finished] = await messages(thread);
  await react(thread, finished?.id ?? '', '👍', true);
  await chat.events.until(endedOn(thread, 2));
  const afterQuiet = { history: (await messages(thread)).length, events: kinds(thread) };

  await chat.send(thread, 'Shall I deploy?');
  const proposal = (await messages(thread)).at(-1);
  await react(thread, proposal?.id ?? '', '👍', true);
  await chat.events.until(endedOn(thread, 4));

  expect({
    afterQuiet,
    goAhead: (await messages(thread)).slice(-1).map(({ kind, text }) => `${kind}: ${hidePid(text)}`),
    eventsAfterGoAhead: kinds(thread).slice(afterQuiet.events.length),
  }).toMatchInlineSnapshot(`
    {
      "afterQuiet": {
        "events": [
          "generation.started",
          "generation.status",
          "generation.finished",
          "reactions.changed",
          "generation.started",
          "generation.status",
          "generation.background-finished",
        ],
        "history": 2,
      },
      "eventsAfterGoAhead": [
        "generation.started",
        "generation.status",
        "generation.finished",
        "reactions.changed",
        "generation.started",
        "generation.status",
        "generation.finished",
      ],
      "goAhead": [
        "assistant: hello from pid <pid>: The user reacted 👍 to one of your earlier replies in this chat, quoted below. This is a reaction, not a new message.
    When that reply asked for approval, a go-ahead or a choice, take the reaction as the user’s answer and carry on with the work.
    When it needs no answer, call the stay_quiet tool and end your turn without writing anything: the user then gets no new message.

    <your-reply>
    hello from pid <pid>: Shall I deploy?
    </your-reply>",
      ],
    }
  `);
});

it('allows stay_quiet only where the effective setting allows it: Settings › Chat over each agent’s own', async () => {
  const { agent, thread } = await agentWithChat();
  const defaults = ChatSettings.parse((await chat.host.call('GET', '/api/settings/chat')).body);
  const invalid = (await chat.host.call('PUT', '/api/settings/chat', { emojiReplies: 'sometimes' })).status;
  const outcomes: Record<string, string> = {};
  const globals: readonly EmojiRepliesSetting[] = ['per_agent', 'all', 'off'];
  const own: readonly AgentEmojiReplies[] = ['allowed', 'off'];
  for (const global of globals) {
    for (const setting of own) {
      await chat.host.call('PUT', '/api/settings/chat', { emojiReplies: global });
      await chat.host.call('PATCH', `/api/agents/${agent.id}`, { emojiReplies: setting });
      const before = (await messages(thread)).length;
      await chat.send(thread, 'host-tool stay_quiet {}');
      const added = (await messages(thread)).slice(before + 1);
      outcomes[`${global} × ${setting}`] = added.length === 0 ? 'silent' : `replied: ${added.map(({ text }) => text).join(' | ')}`;
    }
  }

  expect({ defaults, invalid, outcomes }).toMatchInlineSnapshot(`
    {
      "defaults": {
        "emojiReplies": "per_agent",
      },
      "invalid": 400,
      "outcomes": {
        "all × allowed": "silent",
        "all × off": "silent",
        "off × allowed": "replied: stay_quiet: error The user turned emoji-only and silent replies off for you: answer with a text reply.",
        "off × off": "replied: stay_quiet: error The user turned emoji-only and silent replies off for you: answer with a text reply.",
        "per_agent × allowed": "silent",
        "per_agent × off": "replied: stay_quiet: error The user turned emoji-only and silent replies off for you: answer with a text reply.",
      },
    }
  `);
});
