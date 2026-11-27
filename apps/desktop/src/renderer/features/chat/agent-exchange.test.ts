import type { AgentMessage, Message } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { summarize, timelineItems, type TimelineItem } from './agent-exchange.ts';

const at = (second: number): string => new Date(Date.UTC(2026, 0, 1, 9, 0, second)).toISOString();
const MAIN = 't-lead';

function user(id: string, second: number): Message {
  return { kind: 'user', id, threadId: MAIN, text: id, createdAt: at(second) };
}

function agentMessage(id: string, second: number, from: 'lead' | 'helper' | 'critic', options: Partial<Pick<AgentMessage, 'expectsReply' | 'replyToMessageId'>> = {}): AgentMessage {
  const lead = { agentId: 'lead', threadId: MAIN };
  const other = (agentId: string) => ({ agentId, threadId: `t-${agentId}` });
  return {
    id,
    from: from === 'lead' ? lead : other(from),
    to: from === 'lead' ? other('helper') : lead,
    text: id,
    expectsReply: options.expectsReply ?? false,
    replyToMessageId: options.replyToMessageId ?? null,
    depth: options.replyToMessageId === undefined ? 0 : 1,
    createdAt: at(second),
  };
}

const shape = (items: TimelineItem[]) =>
  items.map((item) => (item.kind === 'message' ? item.message.id : { exchange: item.messages.map(({ id }) => id), summary: summarize(item.messages, MAIN) }));

it('groups agent messages between chat messages into exchanges, worded from the chat agent’s side', () => {
  const messages = [user('u1', 0), user('u2', 10), user('u3', 20)];
  const agentMessages = [
    agentMessage('early', 1, 'lead'),
    agentMessage('ask', 11, 'lead', { expectsReply: true }),
    agentMessage('answer', 12, 'helper', { replyToMessageId: 'ask' }),
    agentMessage('note', 13, 'critic'),
    agentMessage('late', 30, 'helper', { expectsReply: true }),
  ];
  expect({ all: shape(timelineItems(messages, agentMessages, 0)), fromSecond: shape(timelineItems(messages, agentMessages, 1)) }).toMatchInlineSnapshot(`
    {
      "all": [
        "u1",
        {
          "exchange": [
            "early",
          ],
          "summary": {
            "at": "2026-01-01T09:00:01.000Z",
            "kind": "single",
            "peerId": "helper",
            "verb": "Informed",
          },
        },
        "u2",
        {
          "exchange": [
            "ask",
            "answer",
            "note",
          ],
          "summary": {
            "at": "2026-01-01T09:00:13.000Z",
            "count": 3,
            "kind": "burst",
            "peerIds": [
              "helper",
              "critic",
            ],
          },
        },
        "u3",
        {
          "exchange": [
            "late",
          ],
          "summary": {
            "at": "2026-01-01T09:00:30.000Z",
            "kind": "single",
            "peerId": "helper",
            "verb": "Question from",
          },
        },
      ],
      "fromSecond": [
        "u2",
        {
          "exchange": [
            "ask",
            "answer",
            "note",
          ],
          "summary": {
            "at": "2026-01-01T09:00:13.000Z",
            "count": 3,
            "kind": "burst",
            "peerIds": [
              "helper",
              "critic",
            ],
          },
        },
        "u3",
        {
          "exchange": [
            "late",
          ],
          "summary": {
            "at": "2026-01-01T09:00:30.000Z",
            "kind": "single",
            "peerId": "helper",
            "verb": "Question from",
          },
        },
      ],
    }
  `);
});
