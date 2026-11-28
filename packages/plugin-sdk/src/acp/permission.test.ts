import { expect, it } from 'vitest';
import { decide, permissionResult } from './permission.ts';
import type { PermissionOption } from './protocol.ts';

const OFFERED: PermissionOption[] = [
  { optionId: 'always', kind: 'allow_always' },
  { optionId: 'allow', kind: 'allow_once' },
  { optionId: 'never', kind: 'reject_always' },
  { optionId: 'deny', kind: 'reject_once' },
];

it('sends only reads, searches and fetches to a card, and denies every other kind, known or not', () => {
  const kinds = ['read', 'search', 'fetch', 'edit', 'delete', 'move', 'execute', 'think', 'switch_mode', 'other', 'a-kind-from-a-later-agy', undefined];
  expect(
    Object.fromEntries(kinds.map((kind) => [String(kind), decide({ sessionId: 's', toolCall: { toolCallId: 't', kind, title: 'x', locations: [{ path: '/home/me/a' }] }, options: OFFERED }, '/home/me', 'Antigravity').kind])),
  ).toMatchInlineSnapshot(`
    {
      "a-kind-from-a-later-agy": "deny",
      "delete": "deny",
      "edit": "deny",
      "execute": "deny",
      "fetch": "ask",
      "move": "deny",
      "other": "deny",
      "read": "ask",
      "search": "ask",
      "switch_mode": "deny",
      "think": "deny",
      "undefined": "deny",
    }
  `);
});

it('allows once only when the user chose Allow, never always; a stopped turn answers cancelled', () => {
  expect({
    allowed: permissionResult(OFFERED, { kind: 'chosen', choiceId: 'allow' }, false),
    denied: permissionResult(OFFERED, { kind: 'chosen', choiceId: 'deny' }, false),
    refused: permissionResult(OFFERED, null, false),
    noAllowOnce: permissionResult([OFFERED[0], OFFERED[2]].filter((option) => option !== undefined), { kind: 'chosen', choiceId: 'allow' }, false),
    nothingToReject: permissionResult([], null, false),
    stopped: permissionResult(OFFERED, { kind: 'chosen', choiceId: 'allow' }, true),
  }).toMatchInlineSnapshot(`
    {
      "allowed": {
        "outcome": {
          "optionId": "allow",
          "outcome": "selected",
        },
      },
      "denied": {
        "outcome": {
          "optionId": "deny",
          "outcome": "selected",
        },
      },
      "noAllowOnce": {
        "outcome": {
          "optionId": "never",
          "outcome": "selected",
        },
      },
      "nothingToReject": {
        "outcome": {
          "outcome": "cancelled",
        },
      },
      "refused": {
        "outcome": {
          "optionId": "deny",
          "outcome": "selected",
        },
      },
      "stopped": {
        "outcome": {
          "outcome": "cancelled",
        },
      },
    }
  `);
});

it('masks secrets and shows the home folder as ~ in what a card or a denial says', () => {
  const ask = (kind: string, title: string) => decide({ sessionId: 's', toolCall: { kind, title, locations: [] }, options: OFFERED }, '/home/me', 'Antigravity');
  expect([ask('fetch', 'https://example.com/?api_key=abc123'), ask('execute', 'curl -H "Authorization: Bearer abc.def" /home/me/x')]).toMatchInlineSnapshot(`
    [
      {
        "kind": "ask",
        "summary": "fetch https://example.com/?api_key=***",
      },
      {
        "kind": "deny",
        "status": "Denied execute curl -H "Authorization: Bearer *** ~/x: Ori Kami runs Antigravity read-only.",
      },
    ]
  `);
});
