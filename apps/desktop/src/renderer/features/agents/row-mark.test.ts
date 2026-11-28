import { expect, it } from 'vitest';
import { markOf } from './row-mark.ts';
import type { AgentStatus } from './sidebar-groups.ts';

it('shows dots while working, a badge when the agent needs you, and the unread dot for a new reply', () => {
  const statuses: readonly AgentStatus[] = [
    { kind: 'needs-approval', threadIds: ['t1'] },
    { kind: 'needs-you', reason: 'unbound' },
    { kind: 'needs-you', reason: 'provider' },
    { kind: 'needs-you', reason: 'failed' },
    { kind: 'working' },
    { kind: 'queued' },
    { kind: 'unread' },
    { kind: 'idle' },
  ];
  expect(statuses.map((status) => [status.kind === 'needs-you' ? `needs-you/${status.reason}` : status.kind, markOf(status)])).toMatchInlineSnapshot(`
    [
      [
        "needs-approval",
        {
          "kind": "badge",
          "label": "Needs approval",
          "text": "Approval",
          "tone": "warn",
        },
      ],
      [
        "needs-you/unbound",
        {
          "kind": "badge",
          "label": "Needs you: choose a provider",
          "text": "Set up",
          "tone": "warn",
        },
      ],
      [
        "needs-you/provider",
        {
          "kind": "badge",
          "label": "Needs you: provider not ready",
          "text": "Provider",
          "tone": "warn",
        },
      ],
      [
        "needs-you/failed",
        {
          "kind": "badge",
          "label": "Needs you: last reply failed",
          "text": "Failed",
          "tone": "danger",
        },
      ],
      [
        "working",
        {
          "kind": "dots",
          "label": "Working",
          "moving": true,
        },
      ],
      [
        "queued",
        {
          "kind": "dots",
          "label": "Queued",
          "moving": false,
        },
      ],
      [
        "unread",
        {
          "kind": "unread",
          "label": "New reply",
        },
      ],
      [
        "idle",
        {
          "kind": "none",
        },
      ],
    ]
  `);
});
