import { mainThread, type EntityId, type LastMessage, type ThreadSummary } from '@morrowbot/contracts';
import type { LastMessageRecord, ThreadActivity, ThreadRecord } from './directory.ts';

/** A chat on screen. `threadId: null` is the agent's main chat, as in the chat route. */
export interface ChatOnScreen {
  readonly agentId: EntityId;
  readonly threadId: EntityId | null;
}

/**
 * One host's threads as the phone follows them: the host's summary of each, and the ones with a reply that came
 * while they were not on screen. Unread lives on this phone only, until the chat is opened.
 */
export interface LiveThreads {
  readonly summaries: readonly ThreadSummary[];
  readonly unread: ReadonlySet<EntityId>;
}

export const NO_THREADS: LiveThreads = { summaries: [], unread: new Set() };

function onScreen(summaries: readonly ThreadSummary[], screens: readonly ChatOnScreen[], threadId: EntityId): boolean {
  const thread = summaries.find((each) => each.thread.id === threadId)?.thread;
  if (thread === undefined) return false;
  return screens.some((screen) => {
    if (screen.agentId !== thread.agentId) return false;
    if (screen.threadId !== null) return screen.threadId === thread.id;
    return mainThread(summaries.filter((each) => each.thread.agentId === thread.agentId).map((each) => each.thread))?.id === thread.id;
  });
}

/** The host's whole list, as after a reload. Unread stays on the active threads that are still there. */
export function listed(state: LiveThreads, summaries: readonly ThreadSummary[]): LiveThreads {
  const active = summaries.filter(({ thread }) => thread.archivedAt === null);
  const ids = new Set(active.map(({ thread }) => thread.id));
  return { summaries: active, unread: new Set([...state.unread].filter((id) => ids.has(id))) };
}

/** One thread's new summary. Archived threads drop out; a reply newer than the last one seen is unread unless its chat is on screen. */
export function changed(state: LiveThreads, summary: ThreadSummary, screens: readonly ChatOnScreen[]): LiveThreads {
  const { id } = summary.thread;
  if (summary.thread.archivedAt !== null) {
    const summaries = state.summaries.filter(({ thread }) => thread.id !== id);
    const unread = new Set([...state.unread].filter((each) => each !== id));
    return { summaries, unread };
  }
  const before = state.summaries.find(({ thread }) => thread.id === id);
  const summaries = before === undefined ? [...state.summaries, summary] : state.summaries.map((each) => (each === before ? summary : each));
  const last = summary.lastMessage;
  const newReply = last?.kind === 'assistant' && last.at !== before?.lastMessage?.at;
  if (!newReply || onScreen(summaries, screens, id)) return { ...state, summaries };
  return { summaries, unread: new Set([...state.unread, id]) };
}

/** The chats now on screen: they are read. */
export function viewed(state: LiveThreads, screens: readonly ChatOnScreen[]): LiveThreads {
  const unread = [...state.unread].filter((id) => !onScreen(state.summaries, screens, id));
  return unread.length === state.unread.size ? state : { ...state, unread: new Set(unread) };
}

/** What a row shows: the host's activity, or `unread` for an idle thread with a reply not yet read. */
export function threadRecords(state: LiveThreads, hostId: EntityId): ThreadRecord[] {
  return state.summaries.map(({ thread, activity }): ThreadRecord => {
    const shown: ThreadActivity = activity.kind === 'idle' && state.unread.has(thread.id) ? { kind: 'unread' } : activity;
    return { hostId, thread, activity: shown };
  });
}

/** Each agent's newest message, with `message` in place of its agent's when it is as new or newer. */
export function withLastMessage(records: readonly LastMessageRecord[], hostId: EntityId, message: LastMessage): readonly LastMessageRecord[] {
  const current = records.find((record) => record.hostId === hostId && record.message.agentId === message.agentId);
  if (current === undefined) return [...records, { hostId, message }];
  if (current.message.at > message.at) return records;
  return records.map((record) => (record === current ? { hostId, message } : record));
}
