import { readOptionalFile, z, type TurnChunk } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import type { DaemonEvent } from './daemon.ts';
import { countTokens, type Baseline } from './tokens.ts';
import { createTurnStream, outcomeOf } from './turn-stream.ts';

async function fixture(name: string): Promise<string> {
  const text = await readOptionalFile(decodeURIComponent(new URL(`./fixtures/0.171.0/${name}`, import.meta.url).pathname), { maxBytes: 1_000_000 });
  if (text === null) throw new Error(`missing fixture ${name}`);
  return text;
}

const Notification = z.looseObject({ method: z.string(), params: z.unknown() });

/** Every notification of a real Codex 0.171 session: a new thread's turn, a second turn, then a cold resume. */
const SESSION: DaemonEvent[] = (await fixture('session.jsonl'))
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => ({ kind: 'notification', ...Notification.parse(JSON.parse(line)) }));

/** The events after the previous turn ended, up to and including this turn's `turn/completed`. */
function segment(turnId: string): DaemonEvent[] {
  const ends = SESSION.flatMap((event, index) => (event.kind === 'notification' && event.method === 'turn/completed' ? [index] : []));
  const turn = Number(turnId.replace('turn-', '')) - 1;
  return SESSION.slice(turn === 0 ? 0 : (ends[turn - 1] ?? 0) + 1, (ends[turn] ?? -1) + 1);
}

async function replay(turnId: string, baseline: Baseline): Promise<unknown> {
  const chunks: TurnChunk[] = [];
  let hints = 0;
  const tokens = countTokens(baseline, () => turnId);
  const stream = createTurnStream({ threadId: 'thread-1', home: '/Users/user', access: 'read-only', emit: (chunk) => chunks.push(chunk), tokens, onRateLimitHint: () => (hints += 1), onAnnounced: () => undefined });
  const events = segment(turnId);
  const started = events.findIndex((event) => event.kind === 'notification' && event.method === 'turn/started');
  for (const event of events.slice(0, started + 1)) stream.hear(event);
  stream.begin(turnId);
  for (const event of events.slice(started + 1)) stream.hear(event);
  return { chunks, finalText: stream.finalText(), outcome: outcomeOf(await stream.finished, false), hints, usage: tokens.usage() };
}

it('replays a real new-thread turn: reasoning shows as Thinking, the text streams, and its tokens come from zero', async () => {
  expect(await replay('turn-1', { kind: 'new-thread' })).toMatchInlineSnapshot(`
    {
      "chunks": [
        {
          "kind": "status",
          "text": "Thinking",
        },
        {
          "kind": "text",
          "text": "NOS",
        },
        {
          "kind": "text",
          "text": "HELL",
        },
        {
          "kind": "text",
          "text": "

    ",
        },
        {
          "kind": "text",
          "text": "DONE",
        },
      ],
      "finalText": "NOSHELL

    DONE",
      "hints": 1,
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
      "usage": {
        "cacheWriteTokens": 0,
        "cachedInputTokens": 9344,
        "inputTokens": 1348,
        "kind": "reported",
        "outputTokens": 69,
        "reasoningTokens": 59,
      },
    }
  `);
});

it('replays a real cold resume: the replayed total of the last turn sets the baseline and is not counted', async () => {
  expect(await replay('turn-3', { kind: 'unknown' })).toMatchInlineSnapshot(`
    {
      "chunks": [
        {
          "kind": "text",
          "text": "AG",
        },
        {
          "kind": "text",
          "text": "AIN",
        },
      ],
      "finalText": "AGAIN",
      "hints": 1,
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
      "usage": {
        "cacheWriteTokens": 0,
        "cachedInputTokens": 10624,
        "inputTokens": 168,
        "kind": "reported",
        "outputTokens": 6,
        "reasoningTokens": 0,
      },
    }
  `);
});

it('names the turn from turn/started when turn/start was never answered, announcing it once', () => {
  const announced: string[] = [];
  const stream = createTurnStream({ threadId: 'thread-1', home: null, access: 'read-only', emit: () => undefined, tokens: countTokens({ kind: 'new-thread' }, () => null), onRateLimitHint: () => undefined, onAnnounced: (id) => announced.push(id) });
  for (const event of [...segment('turn-2'), ...segment('turn-2')]) stream.hear(event);
  expect({ startedTurn: stream.startedTurn(), announced }).toEqual({ startedTurn: 'turn-2', announced: ['turn-2'] });
});

it('drops another thread\'s events heard before the turn is named', async () => {
  const chunks: TurnChunk[] = [];
  const stream = createTurnStream({ threadId: 'thread-2', home: null, access: 'read-only', emit: (chunk) => chunks.push(chunk), tokens: countTokens({ kind: 'new-thread' }, () => null), onRateLimitHint: () => undefined, onAnnounced: () => undefined });
  for (const event of segment('turn-2')) stream.hear(event);
  stream.begin('turn-2');
  stream.hear({ kind: 'exited' });
  expect({ chunks, finish: await stream.finished }).toEqual({ chunks: [], finish: { kind: 'exited' } });
});

it('delivers a steer when Codex starts the user message turn/steer sent with its clientId, once', () => {
  const chunks: TurnChunk[] = [];
  const stream = createTurnStream({ threadId: 'thread-1', home: null, access: 'read-only', emit: (chunk) => chunks.push(chunk), tokens: countTokens({ kind: 'new-thread' }, () => null), onRateLimitHint: () => undefined, onAnnounced: () => undefined });
  stream.begin('turn-1');
  stream.expectSteer('client-1', 'steer-1');
  // The prompt's own user message and a steer's, as Codex 0.171 sent them (ids and times shortened).
  const userMessage = (method: string, clientId: string | null, text: string): DaemonEvent => ({
    kind: 'notification',
    method,
    params: {
      item: { type: 'userMessage', id: `item-${text}`, clientId, content: [{ type: 'text', text, text_elements: [] }], startedAtMs: 1, completedAtMs: null },
      threadId: 'thread-1',
      turnId: 'turn-1',
      startedAtMs: 1,
    },
  });
  stream.hear(userMessage('item/started', null, 'Run cat on each file.'));
  stream.hear(userMessage('item/started', 'client-1', 'Also, what is 3+3?'));
  stream.hear(userMessage('item/completed', 'client-1', 'Also, what is 3+3?'));
  expect({ chunks, droppedAfterDelivery: stream.dropSteer('client-1') }).toMatchInlineSnapshot(`
    {
      "chunks": [
        {
          "kind": "steer-delivered",
          "steerId": "steer-1",
        },
      ],
      "droppedAfterDelivery": false,
    }
  `);
});
