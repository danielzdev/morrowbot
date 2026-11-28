import type { Message, MessageReaction } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { chatDisplay } from './display.ts';
import { replaceReactions } from './reactions.ts';
import { viewOf } from './thread-model.ts';
import { Timeline, type TimelineContext } from './Timeline.tsx';

const AT = '2026-01-01T00:00:00.000Z';
const reaction = (messageId: string, actor: 'user' | 'agent', emoji: string): MessageReaction => ({ messageId, actor, emoji, createdAt: AT });
const MESSAGES: Message[] = [
  { kind: 'user', id: 'u1', threadId: 't', text: 'Sounds good', createdAt: AT, attachments: [] },
  { kind: 'assistant', attachments: [], id: 'a1', threadId: 't', text: 'Done.', createdAt: AT, outcome: { kind: 'completed', finishReason: 'stop' } },
];
const CTX: TimelineContext = {
  display: chatDisplay(null, null),
  copy: { provider: null, safe: () => null },
  actions: { openLink: () => undefined, copy: () => undefined },
  onAction: () => undefined,
  onAnswer: () => undefined,
  onReact: () => undefined,
  agentName: 'Helper',
  engine: ({ pluginId }) => pluginId,
  image: () => Promise.resolve(null),
  files: { url: (id) => id, act: () => Promise.resolve({ kind: 'cancelled' }) },
  peers: { name: () => 'Peer', color: () => '#6b7280', avatar: () => null },
  avatar: () => null,
};

it("labels the agent's reaction on a user message and makes the user's own on a reply a pressed toggle", () => {
  const state = { thread: { id: 't', agentId: 'a', title: 'Chat', createdAt: AT, updatedAt: AT, archivedAt: null }, messages: MESSAGES, toolSteps: [], activeTurn: null, queue: [], blockedGroups: [], subagents: [], cursor: { hostEpoch: 'e', seq: 0 } };
  const reactions = replaceReactions([reaction('u1', 'agent', '👍')], 'a1', [reaction('a1', 'user', '🎉')]);
  const html = renderToString(h(Timeline, { view: viewOf({ ...state, reactions: [...reactions] }), start: 0, answering: [], idle: true, locked: false, offline: false, ctx: CTX, onShowEarlier: () => undefined, activity: 'idle' }));
  const pills = [...html.matchAll(/<(button|span) [^>]*class="reaction-pill[^"]*"[^>]*>/g)].map(([tag = '']) => tag);
  expect(pills).toMatchInlineSnapshot(`
    [
      "<span role="img" aria-label="Helper reacted 👍" class="reaction-pill agent">",
      "<button type="button" aria-pressed="true" aria-label="Your 🎉 reaction" title="Remove your reaction" class="reaction-pill mine">",
    ]
  `);
});
