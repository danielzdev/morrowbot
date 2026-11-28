import type { Message } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { chatDisplay } from './display.ts';
import { findMatches, MAX_MATCHES, occurrences, searchableOf, stepMatch } from './find.ts';
import { earlierStart, firstShown, growthOf, nearBottom, onGrowth } from './scroll-anchor.ts';
import { viewOf, type ThreadView } from './thread-model.ts';
import { Timeline, type TimelineContext } from './Timeline.tsx';

const AT = '2026-01-01T00:00:00.000Z';
const REPLY = 'Here is **step %n** of the plan:\n\n- buy milk\n- call the shop at https://example.com\n\n```sh\necho %n\n```';

/** A chat of `count` messages, alternating the user and long-ish Markdown replies. */
function chatOf(count: number): ThreadView {
  const messages: Message[] = Array.from({ length: count }, (_, index): Message =>
    index % 2 === 0
      ? { kind: 'user', id: `m${String(index)}`, threadId: 't', text: `Question ${String(index)}`, createdAt: AT, attachments: [] }
      : { kind: 'assistant', attachments: [], id: `m${String(index)}`, threadId: 't', text: REPLY.replaceAll('%n', String(index)), createdAt: AT, outcome: { kind: 'completed', finishReason: 'stop' } },
  );
  return viewOf({ thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT, archivedAt: null }, messages, reactions: [], toolSteps: [], activeTurn: null, queue: [], blockedGroups: [], subagents: [], cursor: { hostEpoch: 'e', seq: 0 } });
}

const CTX: TimelineContext = {
  display: chatDisplay(null, null),
  copy: { provider: null, safe: () => null },
  actions: { openLink: () => undefined, copy: () => undefined },
  onAction: () => undefined,
  onAnswer: () => undefined,
  onReact: () => undefined,
  agentName: 'Helper',
  image: () => Promise.resolve(null),
  files: { url: (id) => id, act: () => Promise.resolve({ kind: 'cancelled' }) },
  peers: { name: () => 'Peer', color: () => '#6b7280', avatar: () => null },
  engine: ({ pluginId }) => pluginId,
  avatar: () => null,
};

const render = (view: ThreadView, start: number): string =>
  renderToString(h(Timeline, { view, start, answering: [], idle: true, locked: false, offline: false, ctx: CTX, onShowEarlier: () => undefined, activity: 'idle' }));

it('renders only the latest 200 of 5,000 messages, and each Show earlier adds 200 more', () => {
  const view = chatOf(5_000);
  const start = firstShown(view.messages.length);
  const started = performance.now();
  const html = render(view, start);
  const ms = performance.now() - started;
  const earlier = render(view, earlierStart(start));
  const count = (out: string): number => out.match(/class="message /g)?.length ?? 0;
  expect({ start, rendered: count(html), showEarlier: /Show earlier \(4800 more\)/.test(html), afterOne: count(earlier), toTop: earlierStart(100), toMatch: earlierStart(4_800, 1_234) }).toEqual({
    start: 4_800,
    rendered: 200,
    showEarlier: true,
    afterOne: 400,
    toTop: 0,
    toMatch: 1_234,
  });
  expect(ms).toBeLessThan(500);
});

it('keeps the newest matches when a common query passes the cap, so recent messages stay reachable', () => {
  const items = Array.from({ length: 5_000 }, (_, index) => ({ id: `m${String(index)}`, text: 'a a a' }));
  const matches = findMatches(items, 'a');
  expect({ total: matches.length, oldest: matches[0], newest: matches.at(-1) }).toEqual({
    total: MAX_MATCHES,
    oldest: { id: 'm1666', item: 1_666, nth: 0 },
    newest: { id: 'm4999', item: 4_999, nth: 2 },
  });
});

it('finds spans in the text as shown, even where lower-casing changes its length', () => {
  expect([occurrences('İx and İX', 'x'), occurrences('a.b a-b', '.'), occurrences('Milk, milk', 'MILK')]).toEqual([
    [{ at: 1, length: 1 }, { at: 8, length: 1 }],
    [{ at: 1, length: 1 }],
    [{ at: 0, length: 4 }, { at: 6, length: 4 }],
  ]);
});

it('finds across all 5,000 loaded messages, rendered or not, fast enough to run on every keystroke', () => {
  const view = chatOf(5_000);
  const items = searchableOf(view);
  const started = performance.now();
  const milk = findMatches(items, 'MILK');
  const again = findMatches(items, 'step 1234 ');
  const ms = performance.now() - started;
  expect({ milk: milk.length, first: milk[0], again, wraps: [stepMatch(3, 2, 1), stepMatch(3, 0, -1), stepMatch(0, 0, 1)] }).toEqual({
    milk: 2_500,
    first: { id: 'm1', item: 1, nth: 0 },
    again: [],
    wraps: [0, 2, 0],
  });
  expect([findMatches(items, 'step 1235 ').length, findMatches(items, 'STEP 1235').length]).toEqual([1, 1]);
  expect(ms).toBeLessThan(500);
});

it('follows new output near the bottom and shows the pill otherwise', () => {
  const view = chatOf(4);
  expect({
    atBottom: nearBottom({ scrollTop: 920, scrollHeight: 1_500, clientHeight: 500 }),
    readingAbove: nearBottom({ scrollTop: 900, scrollHeight: 1_500, clientHeight: 500 }),
    following: onGrowth(true, false),
    reading: onGrowth(false, false),
    sentWhileReading: onGrowth(false, true),
    growsOnText: growthOf(view) !== growthOf({ ...view, activeTurn: { generationId: 'g', trigger: { kind: 'chat' }, state: 'running', queueNote: null, detail: null, text: 'x', steps: [], startedAt: 0 } }),
  }).toEqual({ atBottom: true, readingAbove: false, following: 'follow', reading: 'pill', sentWhileReading: 'follow', growsOnText: true });
});
