import type { AssistantMessage, ThreadState, UserMessage } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextActivity, type ChatActivity } from './activity.ts';
import { chatDisplay } from './display.ts';
import { applyEvent, viewOf, type ThreadEvent, type ThreadView } from './thread-model.ts';
import { Timeline, type TimelineContext } from './Timeline.tsx';

const AT = '2026-01-01T00:00:00.000Z';
const STATE: ThreadState = {
  thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT, archivedAt: null },
  messages: [],
  activeTurn: null,
  queue: [],
  blockedGroups: [],
  subagents: [],
  reactions: [],
  toolSteps: [],
  cursor: { hostEpoch: 'e', seq: 0 },
};
const PEERS = { name: () => 'Peer', color: () => '#6b7280', avatar: () => null };
const CTX: TimelineContext = {
  display: chatDisplay(null, null),
  copy: { provider: null, safe: (text) => text },
  actions: { openLink: () => undefined, copy: () => undefined },
  onAction: () => undefined,
  onAnswer: () => undefined,
  onReact: () => undefined,
  agentName: 'Friday',
  image: () => Promise.resolve(null),
  files: { url: (id) => id, act: () => Promise.resolve({ kind: 'cancelled' }) },
  peers: PEERS,
  engine: ({ pluginId }) => pluginId,
  avatar: (activity) => h('i', { 'data-avatar': activity }),
  tools: false,
  cards: { peers: PEERS, owner: true, onAct: () => undefined, onOpenPlugin: null },
};

const user = (id: string, text: string): UserMessage => ({ kind: 'user', id, threadId: 't', text, createdAt: AT, attachments: [] });
const reply = (id: string, text: string, outcome: AssistantMessage['outcome'] = { kind: 'completed', finishReason: 'stop' }): AssistantMessage => ({
  kind: 'assistant',
  id,
  threadId: 't',
  text,
  outcome,
  attachments: [],
  createdAt: AT,
});

type Body = ThreadEvent extends infer E ? (E extends ThreadEvent ? Omit<E, 'threadId' | 'cursor'> : never) : never;

/** A chat as the window shows it: the view and the activity the sidebar works out from it. */
interface Chat {
  readonly view: ThreadView;
  readonly activity: ChatActivity;
}

/** `chat` after `bodies` arrive at `now` (ms). */
function play(chat: Chat, bodies: readonly Body[], now = 0): Chat {
  return bodies.reduce((before, body) => {
    const applied = applyEvent(before.view, { ...body, threadId: 't', cursor: { hostEpoch: 'e', seq: before.view.cursor.seq + 1 } }, now);
    if (applied.kind !== 'applied') throw new Error(`${body.kind}: ${applied.kind}`);
    return { view: applied.view, activity: nextActivity(before.activity, applied.view, before.view) };
  }, chat);
}

/**
 * The timeline top to bottom: each message, and inside a reply or the running turn its text and its turn rows,
 * an avatar row shown as "[its activity] label".
 */
function order({ view, activity }: Chat): string[] {
  const html = renderToString(
    h(Timeline, { view, start: 0, answering: [], cardActing: [], idle: view.activeTurn === null, locked: false, offline: false, ctx: CTX, onShowEarlier: () => undefined, activity }),
  );
  const pattern = /<div (?:data-message-id="([^"]+)" )?class="message (user|assistant[^"]*)">|<div data-find-id="[^"]+">(.*?)<\/div><\/div>|<div class="turn-time[^"]*">(.*?)<\/div>/g;
  const plain = (part: string): string => part.replace(/<i data-avatar="([^"]+)"><\/i>/g, '[$1] ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();
  return [...html.matchAll(pattern)].map(([, id, kind, text, row]) => {
    if (kind !== undefined) return kind === 'user' ? `user ${id ?? ''}` : kind.includes('active') ? 'running turn' : `reply ${id ?? ''}`;
    return text !== undefined ? `  “${plain(text)}”` : `  ${plain(row ?? '')}`;
  });
}

const FIRST = user('u1', 'Find the tide tables');
const NEXT = user('u2', 'And tomorrow?');
const started = (generationId: string, userMessage: UserMessage): Body => ({ kind: 'generation.started', generationId, state: 'running', userMessage });
const writing = (generationId: string, text: string): Body => ({ kind: 'generation.delta', generationId, text });
const finished = (generationId: string, message: AssistantMessage): Body => ({ kind: 'generation.finished', generationId, message });
/** The first turn, written and still running. */
const running = (): Chat => play({ view: viewOf(STATE), activity: 'idle' }, [started('g1', FIRST), writing('g1', 'High tide is at 6.')]);
/** The first turn's reply, 12 s after it started. */
const answered = (chat: Chat): Chat => play(chat, [finished('g1', reply('m1', 'High tide is at 6.'))], 12_000);

beforeEach(() => {
  vi.useFakeTimers({ now: 12_000 });
});
afterEach(() => {
  vi.useRealTimers();
});

it('sending while idle puts the new message last and the working avatar below it', () => {
  const idle = answered(running());
  const settled = { ...idle, activity: 'idle' as const };
  const sent = play(settled, [started('g2', NEXT)], 12_000);
  expect({ sent: order(sent), answering: order(play(sent, [writing('g2', 'At 7.')])) }).toMatchInlineSnapshot(`
    {
      "answering": [
        "user u1",
        "reply m1",
        "  Worked for 12s",
        "  “High tide is at 6.”",
        "user u2",
        "running turn",
        "  “At 7.”",
        "  [streaming] Writing · <1s",
      ],
      "sent": [
        "user u1",
        "reply m1",
        "  Worked for 12s",
        "  “High tide is at 6.”",
        "user u2",
        "running turn",
        "  [thinking] Thinking · <1s",
      ],
    }
  `);
});

it('sending during the completion beat moves the avatar off the reply and below the new message', () => {
  const beat = answered(running());
  expect({ activity: beat.activity, beat: order(beat), sent: order(play(beat, [started('g2', NEXT)], 12_000)) }).toMatchInlineSnapshot(`
    {
      "activity": "completed",
      "beat": [
        "user u1",
        "reply m1",
        "  Worked for 12s",
        "  “High tide is at 6.”",
        "  [completed] Done",
      ],
      "sent": [
        "user u1",
        "reply m1",
        "  Worked for 12s",
        "  “High tide is at 6.”",
        "user u2",
        "running turn",
        "  [thinking] Thinking · <1s",
      ],
    }
  `);
});

it('a steer mid-turn puts the steered message after the reply so far, and the avatar below it', () => {
  const steered = play(running(), [{ kind: 'generation.steered', generationId: 'g1', segment: reply('s1', 'High tide is at 6.', { kind: 'steered' }), userMessage: NEXT }]);
  expect({ running: order(running()), steered: order(steered), answering: order(play(steered, [writing('g1', 'Tomorrow at 7.')])) }).toMatchInlineSnapshot(`
    {
      "answering": [
        "user u1",
        "reply s1",
        "  Worked for <1s",
        "  “High tide is at 6.”",
        "user u2",
        "running turn",
        "  “Tomorrow at 7.”",
        "  [streaming] Writing · 12s",
      ],
      "running": [
        "user u1",
        "running turn",
        "  “High tide is at 6.”",
        "  [streaming] Writing · 12s",
      ],
      "steered": [
        "user u1",
        "reply s1",
        "  Worked for <1s",
        "  “High tide is at 6.”",
        "user u2",
        "running turn",
        "  [thinking] Thinking · 12s",
      ],
    }
  `);
});

it('a message queued during a turn runs next below the reply, with the avatar below it', () => {
  const queued = play(running(), [{ kind: 'queue.changed', queue: [{ ...NEXT, state: { kind: 'queued' } }] }]);
  const replied = answered(queued);
  const delivered = play(replied, [started('g2', NEXT), { kind: 'queue.changed', queue: [] }], 12_000);
  expect({ queued: order(queued), replied: order(replied), delivered: order(delivered) }).toMatchInlineSnapshot(`
    {
      "delivered": [
        "user u1",
        "reply m1",
        "  Worked for 12s",
        "  “High tide is at 6.”",
        "user u2",
        "running turn",
        "  [thinking] Thinking · <1s",
      ],
      "queued": [
        "user u1",
        "running turn",
        "  “High tide is at 6.”",
        "  [streaming] Writing · 12s",
      ],
      "replied": [
        "user u1",
        "reply m1",
        "  Worked for 12s",
        "  “High tide is at 6.”",
        "  [completed] Done",
      ],
    }
  `);
});
