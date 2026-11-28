import type { Thread } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import { afterClose, tabsOf } from './tabs.ts';

const thread = (id: string, day: number): Thread => ({ id, agentId: 'a', title: `Chat ${id}`, createdAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`, updatedAt: '2026-11-27T10:00:00.000Z' });
const threads = [thread('d', 4), thread('c', 3), thread('b', 2), thread('a', 1)];
const ids = (tabs: ReturnType<typeof tabsOf>) => ({ main: tabs.main?.id ?? null, others: tabs.others.map(({ id }) => id) });

describe('tabsOf', () => {
  it('keeps the first chat as the main tab and lists kept chats in their saved order', () => {
    expect(ids(tabsOf(threads, ['c', 'b'], 'c'))).toMatchInlineSnapshot(`
      {
        "main": "a",
        "others": [
          "c",
          "b",
        ],
      }
    `);
  });

  it('adds the chat on screen at the end, never duplicates the main chat, and drops deleted chats', () => {
    expect(ids(tabsOf(threads, ['a', 'gone', 'b'], 'd'))).toMatchInlineSnapshot(`
      {
        "main": "a",
        "others": [
          "b",
          "d",
        ],
      }
    `);
  });

  it('has only an empty main tab before the first chat exists', () => {
    expect(ids(tabsOf([], ['x'], null))).toMatchInlineSnapshot(`
      {
        "main": null,
        "others": [],
      }
    `);
  });

  it('pins the first-created chat by createdSeq when two chats share a millisecond and the second has a smaller id', () => {
    const sameMs: Thread[] = [
      { id: 'a-second', agentId: 'a', title: 'Second', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z', createdSeq: 2 },
      { id: 'z-first', agentId: 'a', title: 'First', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', createdSeq: 1 },
    ];
    expect(ids(tabsOf(sameMs, ['a-second'], null))).toMatchInlineSnapshot(`
      {
        "main": "z-first",
        "others": [
          "a-second",
        ],
      }
    `);
  });
});

describe('afterClose', () => {
  it('moves to the tab on the left, or to the main chat from the first tab', () => {
    const tabs = tabsOf(threads, ['b', 'c', 'd'], null);
    expect(['b', 'c', 'd'].map((id) => afterClose(tabs, id))).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
      ]
    `);
  });
});
