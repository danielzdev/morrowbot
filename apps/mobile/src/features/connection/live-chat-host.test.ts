import type { Thread } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import type { ChatHost } from '../../lib/chat-host.ts';
import type { ThreadEvent } from '../../lib/host-connection.ts';
import { connectHost } from './host-transport.ts';
import { createLiveChatHost } from './live-chat-host.ts';
import { echoThread, pair, realSockets, startRealHost, until } from './real-host.test-support.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** The chat's host API on a phone paired with a fresh real host, plus a thread on its `echo` agent. */
async function pairedChat(): Promise<{ readonly chat: ChatHost; readonly thread: Thread }> {
  const host = await startRealHost();
  cleanup.push(host.close);
  const deps = { fetch, openSocket: realSockets([]).open, delayFor: () => 60_000, now: () => 0, report: () => undefined };
  const live = connectHost(await pair(host), deps, () => undefined);
  cleanup.push(live.close);
  return { chat: createLiveChatHost(live.transport), thread: await echoThread(host) };
}

/** Watches `threadId` the way a chat screen does, noting what it is told. */
function watch(chat: ChatHost, threadId: string) {
  const told: { fresh: number; gone: boolean; readonly events: ThreadEvent[] } = { fresh: 0, gone: false, events: [] };
  cleanup.push(
    chat.watch(threadId, {
      onFresh: () => {
        told.fresh += 1;
      },
      onEvent: (event) => told.events.push(event),
      onStale: () => undefined,
      onGone: () => {
        told.gone = true;
      },
    }),
  );
  return told;
}

const finished = (events: readonly ThreadEvent[]) => events.filter((event) => event.kind === 'generation.finished');

it('reads agents, threads, plugins and provider models, parsed with the shared contracts', async () => {
  const { chat, thread } = await pairedChat();
  const [agents, threads, plugins, info] = await Promise.all([chat.agents(), chat.threads(thread.agentId), chat.plugins(), chat.providerInfo('echo')]);
  expect({
    agents: agents.kind === 'ok' ? agents.value.agents.map(({ name }) => name) : agents,
    threads: threads.kind === 'ok' ? threads.value.threads.map(({ title }) => title) : threads,
    plugins: plugins.kind === 'ok' ? plugins.value.plugins.map(({ manifest }) => manifest.id).includes('echo') : plugins,
    models: info.kind === 'ok' && info.value.info.kind === 'ready' ? info.value.info.models.map(({ id }) => id) : info,
  }).toEqual({ agents: ['Helper'], threads: ['Chat'], plugins: true, models: ['tiny'] });
});

it('streams a reply to the watched thread, after its state, and ends the turn', async () => {
  const { chat, thread } = await pairedChat();
  const told = watch(chat, thread.id);
  await until(() => told.fresh === 1);
  const sent = await chat.send(thread.id, 'hello');
  await until(() => finished(told.events).length === 1);
  const deltas = told.events.flatMap((event) => (event.kind === 'generation.delta' ? [event.text] : []));
  const end = finished(told.events)[0];
  expect({
    sent: sent.kind === 'ok' ? sent.value.kind : sent,
    kinds: [...new Set(told.events.map(({ kind }) => kind))],
    streamedWholeReply: deltas.length > 0 && deltas.join('') === end?.message.text,
    outcome: end?.message.outcome,
  }).toEqual({
    sent: 'started',
    kinds: ['generation.started', 'generation.status', 'generation.delta', 'generation.finished'],
    streamedWholeReply: true,
    outcome: { kind: 'completed', finishReason: 'stop' },
  });
});

it('stops a running turn', async () => {
  const { chat, thread } = await pairedChat();
  const told = watch(chat, thread.id);
  await until(() => told.fresh === 1);
  await chat.send(thread.id, 'stall-polite');
  await until(() => told.events.some(({ kind }) => kind === 'generation.started'));
  const stopped = await chat.stop(thread.id);
  expect(stopped.kind === 'ok' && stopped.value.kind === 'stopped' ? stopped.value.message.outcome : stopped).toEqual({ kind: 'cancelled' });
});

it('queues a send while a turn runs, cancels one queued message and steers another into the reply', async () => {
  const { chat, thread } = await pairedChat();
  const told = watch(chat, thread.id);
  await until(() => told.fresh === 1);
  await chat.send(thread.id, 'steerable');
  await until(() => told.events.some(({ kind }) => kind === 'generation.started'));
  const [first, second] = [await chat.send(thread.id, 'never mind'), await chat.send(thread.id, 'go left')];
  const id = (sent: typeof first) => (sent.kind === 'ok' && sent.value.kind === 'queued' ? sent.value.queued.id : 'none');
  const cancelled = await chat.cancelQueued(thread.id, id(first));
  const steered = await chat.steerQueued(thread.id, id(second));
  await until(() => finished(told.events).length === 1);
  const steeredIn = told.events.flatMap((event) => (event.kind === 'generation.steered' ? [event.userMessage.text] : []));
  expect({
    queued: [first, second].map((sent) => (sent.kind === 'ok' ? sent.value.kind : sent)),
    cancelled: cancelled.kind,
    steered: steered.kind,
    steeredIn,
    outcome: finished(told.events)[0]?.message.outcome.kind,
    missing: (await chat.cancelQueued(thread.id, id(first))).kind === 'failed',
  }).toEqual({ queued: ['queued', 'queued'], cancelled: 'ok', steered: 'ok', steeredIn: ['go left'], outcome: 'completed', missing: true });
});

it('answers 404 for an approval the host no longer has, as a stale card does', async () => {
  const { chat, thread } = await pairedChat();
  const told = watch(chat, thread.id);
  await until(() => told.fresh === 1);
  const sent = await chat.send(thread.id, 'hello');
  await until(() => finished(told.events).length === 1);
  const generationId = sent.kind === 'ok' && sent.value.kind === 'started' ? sent.value.generationId : 'none';
  const answered = await chat.answerApproval(thread.id, 'expired-card', { generationId, choiceId: 'allow' });
  expect(answered.kind === 'failed' ? { status: answered.status, kind: answered.error.kind } : answered).toEqual({ status: 404, kind: 'not_found' });
});

it('continues a failed turn as a new generation in the same thread', async () => {
  const { chat, thread } = await pairedChat();
  const told = watch(chat, thread.id);
  await until(() => told.fresh === 1);
  await chat.send(thread.id, 'fail');
  await until(() => finished(told.events).length === 1);
  const failed = finished(told.events)[0]?.message;
  const continued = await chat.continueTurn(thread.id, failed?.id ?? 'none');
  await until(() => finished(told.events).length === 2);
  const starts = told.events.flatMap((event) => (event.kind === 'generation.started' ? [event] : []));
  expect({
    failed: failed?.outcome.kind,
    continued: continued.kind,
    secondStart: { sameGeneration: continued.kind === 'ok' && starts[1]?.generationId === continued.value.generationId, userMessage: starts[1]?.userMessage },
  }).toEqual({ failed: 'failed', continued: 'ok', secondStart: { sameGeneration: true, userMessage: null } });
});

it('tells the watcher when the thread is not on the host', async () => {
  const { chat } = await pairedChat();
  const told = watch(chat, 'deleted-thread');
  await until(() => told.gone);
  expect({ gone: told.gone, fresh: told.fresh }).toEqual({ gone: true, fresh: 0 });
});
