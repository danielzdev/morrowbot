import type { ChatEvent, Thread, ThreadActivity, ThreadSummary } from '@morrowbot/contracts';
import type { ChatCore } from './turn.ts';

export type SummaryListener = (summary: ThreadSummary) => void;

export interface SummaryFeed {
  /** Every thread, most recently changed first. */
  list(): ThreadSummary[];
  /** Tells listeners when the thread's summary differs from the last one they were told. */
  check(threadId: string): void;
  /** The thread is gone; its next summary (if its id comes back) is new. */
  forget(threadId: string): void;
  subscribe(listener: SummaryListener): () => void;
}

/** Events that leave the thread's activity, newest message and order as they were. */
const unchanged = new Set<ChatEvent['kind']>(['generation.delta', 'generation.tool-start', 'generation.tool-end', 'queue.changed', 'usage.updated']);

function activityOf(core: ChatCore, threadId: string): ThreadActivity {
  const turn = core.active.get(threadId);
  if (turn === undefined || turn.state === 'settled') return core.options.store.messages.endsFailed(threadId) ? { kind: 'failed' } : { kind: 'idle' };
  if (turn.state === 'queued') return { kind: 'queued' };
  const [approval] = turn.approvals.values();
  return approval === undefined ? { kind: 'working' } : { kind: 'needs-approval', summary: approval.summary };
}

function summaryOf(core: ChatCore, thread: Thread): ThreadSummary {
  return { thread, activity: activityOf(core, thread.id), lastMessage: core.options.store.messages.lastInThread(thread.id) };
}

/** Each thread's summary, for the lists, and a feed of the ones that change, from thread events and from `check`. */
export function createSummaryFeed(core: ChatCore): SummaryFeed {
  const { store } = core.options;
  const told = new Map<string, string>();
  const listeners = new Set<SummaryListener>();
  const check = (threadId: string): void => {
    const thread = store.threads.get(threadId);
    if (thread === undefined) return;
    const summary = summaryOf(core, thread);
    const key = JSON.stringify(summary);
    if (told.get(threadId) === key) return;
    told.set(threadId, key);
    for (const listener of [...listeners]) listener(summary);
  };
  core.events.subscribe((event) => {
    if (!unchanged.has(event.kind) && 'threadId' in event) check(event.threadId);
  });
  return {
    list: () => store.threads.listAll().map((thread) => summaryOf(core, thread)),
    check,
    forget: (threadId) => {
      told.delete(threadId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
