import type { LastMessage, ThreadActivity, ThreadSummary } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import { changed, listed, NO_THREADS, threadRecords, viewed, withLastMessage, type ChatOnScreen, type LiveThreads } from './live-threads.ts';

const HOST = 'studio-host';

function summary(id: string, title: string, minute: number, activity: ThreadActivity, last: LastMessage['kind'] | null): ThreadSummary {
  const at = `2026-11-27T12:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    thread: { id, agentId: 'trip-planner', title, createdAt: id === 'trips' ? '2026-11-01T00:00:00.000Z' : at, updatedAt: at },
    activity,
    lastMessage: last === null ? null : { agentId: 'trip-planner', threadId: id, kind: last, preview: `${title} ${last}`, at },
  };
}

function rows(state: LiveThreads): string[] {
  return threadRecords(state, HOST).map(({ thread, activity }) => `${thread.title}: ${activity.kind}`);
}

describe('live threads', () => {
  it('follows activity, marks replies unread unless their chat is on screen, and clears them once it is', () => {
    const nothingOnScreen: readonly ChatOnScreen[] = [];
    const lisbonOnScreen: readonly ChatOnScreen[] = [{ agentId: 'trip-planner', threadId: 'lisbon' }];
    const mainOnScreen: readonly ChatOnScreen[] = [{ agentId: 'trip-planner', threadId: null }];
    const steps: Record<string, string[]> = {};
    let state = listed(NO_THREADS, [summary('trips', 'Trips', 0, { kind: 'idle' }, 'assistant'), summary('lisbon', 'Lisbon', 1, { kind: 'idle' }, null)]);
    steps['1 loaded'] = rows(state);
    state = changed(state, summary('trips', 'Trips', 2, { kind: 'working' }, 'user'), nothingOnScreen);
    steps['2 trips working'] = rows(state);
    state = changed(state, summary('trips', 'Trips', 3, { kind: 'idle' }, 'assistant'), nothingOnScreen);
    steps['3 trips replied, off screen'] = rows(state);
    state = changed(state, summary('lisbon', 'Lisbon', 4, { kind: 'needs-approval', summary: 'Book the hotel' }, 'user'), lisbonOnScreen);
    state = changed(state, summary('lisbon', 'Lisbon', 5, { kind: 'idle' }, 'assistant'), lisbonOnScreen);
    steps['4 lisbon replied, on screen'] = rows(state);
    state = viewed(state, mainOnScreen);
    steps['5 main chat opened'] = rows(state);
    state = changed(state, summary('porto', 'New chat', 6, { kind: 'idle' }, null), nothingOnScreen);
    state = changed(state, summary('lisbon', 'Lisbon', 7, { kind: 'failed' }, 'assistant'), nothingOnScreen);
    steps['6 new chat, lisbon failed off screen'] = rows(state);
    state = listed(state, [summary('lisbon', 'Lisbon', 7, { kind: 'idle' }, 'assistant')]);
    steps['7 reloaded: lisbon is still unread'] = rows(state);
    expect(steps).toMatchInlineSnapshot(`
      {
        "1 loaded": [
          "Trips: idle",
          "Lisbon: idle",
        ],
        "2 trips working": [
          "Trips: working",
          "Lisbon: idle",
        ],
        "3 trips replied, off screen": [
          "Trips: unread",
          "Lisbon: idle",
        ],
        "4 lisbon replied, on screen": [
          "Trips: unread",
          "Lisbon: idle",
        ],
        "5 main chat opened": [
          "Trips: idle",
          "Lisbon: idle",
        ],
        "6 new chat, lisbon failed off screen": [
          "Trips: idle",
          "Lisbon: failed",
          "New chat: idle",
        ],
        "7 reloaded: lisbon is still unread": [
          "Lisbon: unread",
        ],
      }
    `);
  });

  it("keeps each agent's newest message for its preview", () => {
    const older = summary('trips', 'Trips', 1, { kind: 'idle' }, 'user').lastMessage;
    const newer = summary('lisbon', 'Lisbon', 2, { kind: 'idle' }, 'assistant').lastMessage;
    if (older === null || newer === null) throw new Error('fixture has messages');
    const once = withLastMessage([], HOST, newer);
    expect({
      first: once.map(({ message }) => message.preview),
      olderIgnored: withLastMessage(once, HOST, older).map(({ message }) => message.preview),
      newerTakesOver: withLastMessage(withLastMessage([], HOST, older), HOST, newer).map(({ message }) => message.preview),
    }).toMatchInlineSnapshot(`
      {
        "first": [
          "Lisbon assistant",
        ],
        "newerTakesOver": [
          "Lisbon assistant",
        ],
        "olderIgnored": [
          "Lisbon assistant",
        ],
      }
    `);
  });
});
