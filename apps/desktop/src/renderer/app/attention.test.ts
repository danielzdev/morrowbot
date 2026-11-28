import { expect, it } from 'vitest';
import type { ThreadActivity } from '../features/chat/index.ts';
import { attentionCopy, attentionFrom, windowTitle } from './attention.ts';

const at = (activity: ThreadActivity['activity'], failed = false, agentId = 'errand'): ThreadActivity => ({ agentId, activity, failed });

it('puts what needs the user first in the window title', () => {
  expect({
    quiet: windowTitle({ a: at('idle'), b: at('completed') }, 'Errand Bot'),
    noAgent: windowTitle({}, null),
    working: windowTitle({ a: at('streaming'), b: at('idle') }, 'Errand Bot'),
    queued: windowTitle({ a: at('queued') }, null),
    approvals: windowTitle({ a: at('needs-approval'), b: at('needs-approval', false, 'reader'), c: at('thinking') }, 'Errand Bot'),
  }).toMatchInlineSnapshot(`
    {
      "approvals": "Needs you (2) · Errand Bot — Ori Bot",
      "noAgent": "Ori Bot",
      "queued": "Working · Ori Bot",
      "quiet": "Errand Bot — Ori Bot",
      "working": "Working · Errand Bot — Ori Bot",
    }
  `);
});

it('notifies once for a new approval and once when a turn ends, never for a chat that only just opened', () => {
  const before = { approve: at('streaming'), done: at('streaming'), broke: at('thinking'), allowed: at('needs-approval'), still: at('needs-approval'), quiet: at('idle') };
  const after = { approve: at('needs-approval'), done: at('completed'), broke: at('idle', true), allowed: at('streaming'), still: at('needs-approval'), quiet: at('idle'), opened: at('needs-approval') };
  const events = attentionFrom(before, after);
  expect(events.map(({ kind, threadId }) => `${threadId}: ${kind}`)).toMatchInlineSnapshot(`
    [
      "approve: approval",
      "done: finished",
      "broke: failed",
    ]
  `);
  expect(events.map((event) => attentionCopy(event, 'Errand Bot', event.threadId === 'done' ? null : 'Grocery plan'))).toMatchInlineSnapshot(`
    [
      {
        "body": "In “Grocery plan”. Open Ori Bot to allow or deny.",
        "title": "Errand Bot needs approval",
      },
      {
        "body": "Open Ori Bot to read it.",
        "title": "Errand Bot replied",
      },
      {
        "body": "In “Grocery plan”. Open the chat to see why.",
        "title": "Errand Bot couldn't finish",
      },
    ]
  `);
});
