import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContinueResponse, MessageList, QueuedSend, ThreadState, type Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ECHO, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { sequence } from './testing/test-host.ts';

let dataDir: string;
let chat: ChatFixture;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'oribot-reactions-recovery-')));
  chat = await startChatFixture({ dataDir, sequence: sequence() });
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
  await rm(dataDir, { recursive: true, force: true });
});

async function latestId(thread: Thread): Promise<string> {
  return MessageList.parse((await chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body).messages.at(-1)?.id ?? '';
}

const react = (thread: Thread, messageId: string, reacted = true) =>
  chat.host.call('PUT', `/api/threads/${thread.id}/reactions`, { messageId, emoji: '👍', reacted });

/** Resolves once `count` turns of the thread have ended, with or without a reply. */
const ended = (thread: Thread, count: number) =>
  chat.events.until(
    () => chat.events.received.filter((each) => (each.kind === 'generation.finished' || each.kind === 'generation.background-finished') && each.threadId === thread.id).length >= count,
  );

it('keeps a reaction the agent could not read yet, and reads it at the next idle moment', async () => {
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'Shall I deploy?');
  await chat.host.call('PATCH', `/api/agents/${agent.id}`, { provider: { kind: 'unbound' } });
  await react(thread, await latestId(thread));
  await chat.host.call('PATCH', `/api/agents/${agent.id}`, { provider: ECHO });
  await chat.send(thread, 'Status?');
  await ended(thread, 3);

  expect((await chat.history(thread)).map((line) => line.split('\n')[0])).toMatchInlineSnapshot(`
    [
      "user: Shall I deploy?",
      "assistant(completed): hello from pid <pid>: Shall I deploy?",
      "user: Status?",
      "assistant(completed): hello from pid <pid>: Status?",
      "assistant(completed): hello from pid <pid>: The user reacted 👍 to one of your earlier replies in this chat, quoted below. This is a reaction, not a new message.",
    ]
  `);
});

it('continues a failed reaction turn from the user’s reaction, and refuses once the reaction is gone', async () => {
  const agent = await chat.agent();
  const failed = async (command: string) => {
    const thread = await chat.thread(agent);
    await chat.send(thread, `Ready? on-reaction ${command}`);
    const reply = await latestId(thread);
    await react(thread, reply);
    await ended(thread, 2);
    return { thread, reply, failedMessageId: await latestId(thread) };
  };
  const once = await failed('once-fail');
  const continued = await chat.host.call('POST', `/api/threads/${once.thread.id}/continue`, { failedMessageId: once.failedMessageId });
  if (continued.status === 202) await chat.events.finished(ContinueResponse.parse(continued.body).generationId);
  const removed = await failed('fail');
  await react(removed.thread, removed.reply, false);
  const gone = await chat.host.call('POST', `/api/threads/${removed.thread.id}/continue`, { failedMessageId: removed.failedMessageId });

  expect({
    continued: continued.status,
    history: (await chat.history(once.thread)).map((line) => line.split('\n')[0]),
    gone: `${String(gone.status)} ${JSON.stringify(gone.body)}`,
  }).toMatchInlineSnapshot(`
    {
      "continued": 202,
      "gone": "409 {"error":{"kind":"conflict","message":"The reaction this reply answered was removed."}}",
      "history": [
        "user: Ready? on-reaction once-fail",
        "assistant(completed): hello from pid <pid>: Ready? on-reaction once-fail",
        "assistant(failed other): hello from pid <pid>:",
        "assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":"<user>\\nReady? on-reaction once-fail\\n</user>\\n<assistant>\\nhello from pid <pid>: Ready? on-reaction once-fail\\n</assistant>"}}",
      ],
    }
  `);
});

it('lets the agent react to a message the user steered into a reaction turn', async () => {
  const thread = await chat.thread(await chat.agent());
  await chat.send(thread, 'Ready? on-reaction steerable');
  await react(thread, await latestId(thread));
  await chat.events.until(() => new Set(chat.events.received.flatMap((each) => (each.kind === 'generation.delta' && each.threadId === thread.id ? [each.generationId] : []))).size === 2);
  const queued = QueuedSend.parse((await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'host-tool react_to_message {"emoji":"👀"}' })).body).queued;
  await chat.host.call('POST', `/api/threads/${thread.id}/queue/${queued.id}/steer`);
  await ended(thread, 2);

  expect({
    history: await chat.history(thread),
    reactions: ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body).reactions.map(({ messageId, actor, emoji }) => `${messageId} ${actor} ${emoji}`),
  }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: Ready? on-reaction steerable",
        "assistant(completed): hello from pid <pid>: Ready? on-reaction steerable",
        "assistant(steered): hello from pid <pid>:",
        "user: host-tool react_to_message {"emoji":"👀"}",
        "assistant(completed):  heard: [The user typed this message in the chat while you were working. It is from the user, not from a tool. Reply to it visibly in your next message, and answer it if it is a question; then carry on with your task with it taken into account.]

    host-tool react_to_message {"emoji":"👀"}
    react_to_message: {"reacted":{"messageId":"id-7","emoji":"👀"}}",
      ],
      "reactions": [
        "id-5 user 👍",
        "id-7 agent 👀",
      ],
    }
  `);
});

it('gives a sub-agent no react_to_message or stay_quiet: the turn that started it waits for its text', async () => {
  const thread = await chat.thread(await chat.agent());
  const prompt = ['host-tool react_to_message {"emoji":"👍"}', 'host-tool stay_quiet {}'].join('\n');
  await chat.send(thread, [`host-tool spawn_subagent ${JSON.stringify({ role: 'Helper', prompt })}`, 'host-tool wait_subagents {}'].join('\n'));
  const { subagents, reactions } = ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body);

  expect({ replies: subagents.map(({ status }) => (status.kind === 'finished' ? status.reply : status.kind)), reactions }).toMatchInlineSnapshot(`
    {
      "reactions": [],
      "replies": [
        "react_to_message: rpc error Unknown tool: react_to_message
    stay_quiet: rpc error Unknown tool: stay_quiet",
      ],
    }
  `);
});
