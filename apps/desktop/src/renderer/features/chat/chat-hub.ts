import type { AssistantMessage } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store } from '../../shared/store.ts';
import { COMPLETED_MS, nextActivity, type ChatActivity } from './activity.ts';
import { memoryDrafts, type DraftStore } from './drafts.ts';
import type { ThreadView } from './thread-model.ts';
import { openThreadSession, type ThreadSession } from './thread-session.ts';

/** What one chat of an agent is doing. */
export interface ThreadActivity {
  readonly agentId: string;
  readonly activity: ChatActivity;
  /** The chat's last reply failed and no turn has started since. */
  readonly failed: boolean;
}

/** The open chats. Each keeps its draft across tab switches and reloads, and all reload after a host restart. */
export interface ChatHub {
  /** What each open chat is doing, by chat id; a chat that is not open, or did not load, is idle. */
  readonly activity: Store<Readonly<Record<string, ThreadActivity>>>;
  /** The chat's session, opened and loaded on first use. */
  session(threadId: string): ThreadSession;
  /** Loads every open chat again, e.g. after a process group was released elsewhere. */
  reloadAll(): void;
  /** Closes an archived chat's live session and clears its activity without erasing any local draft. */
  detach(threadId: string): void;
  forget(threadId: string): void;
  close(): void;
}

export interface ChatHubOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'subscribe' | 'unsubscribe' | 'onEvent' | 'onHostReady' | 'onHostLost'>;
  readonly onFinished?: (threadId: string, message: AssistantMessage) => void;
  readonly onGroupsChanged?: () => void;
  readonly blockedRefreshMs?: number;
  readonly completedMs?: number;
  /** Where unsent drafts are kept; a window passes local storage so they survive a reload. */
  readonly drafts?: DraftStore;
  readonly reconnectMs?: number;
}

export function createChatHub(options: ChatHubOptions): ChatHub {
  const sessions = new Map<string, ThreadSession>();
  const watching = new Map<string, () => void>();
  const completed = new Map<string, ReturnType<typeof setTimeout>>();
  const activity = new Store<Readonly<Record<string, ThreadActivity>>>({});
  const drafts = options.drafts ?? memoryDrafts();
  const setActivity = (threadId: string, next: ThreadActivity | undefined): void => {
    const current = activity.get()[threadId];
    if (current?.agentId === next?.agentId && current?.activity === next?.activity && current?.failed === next?.failed) return;
    activity.update((all) => {
      const others = Object.fromEntries(Object.entries(all).filter(([key]) => key !== threadId));
      return next === undefined ? others : { ...others, [threadId]: next };
    });
  };
  const settle = (threadId: string): void => {
    clearTimeout(completed.get(threadId));
    completed.delete(threadId);
  };
  const watch = (session: ThreadSession): void => {
    const { threadId } = session;
    let previous: ThreadView | null = null;
    watching.set(
      threadId,
      session.screen.subscribe(({ view }) => {
        switch (view.kind) {
          case 'loading':
            return;
          case 'failed':
            previous = null;
            settle(threadId);
            setActivity(threadId, undefined);
            return;
          case 'loaded':
            break;
        }
        const { agentId } = view.value.thread;
        const next = nextActivity(activity.get()[threadId]?.activity, view.value, previous);
        previous = view.value;
        const last = view.value.messages.at(-1);
        const failed = view.value.activeTurn === null && last?.kind === 'assistant' && last.outcome.kind === 'failed';
        if (next !== 'completed') settle(threadId);
        else if (!completed.has(threadId)) {
          completed.set(
            threadId,
            setTimeout(() => {
              completed.delete(threadId);
              setActivity(threadId, { agentId, activity: 'idle', failed });
            }, options.completedMs ?? COMPLETED_MS),
          );
        }
        setActivity(threadId, { agentId, activity: next, failed });
      }),
    );
  };
  const stopWatching = (threadId: string): void => {
    watching.get(threadId)?.();
    watching.delete(threadId);
    settle(threadId);
    setActivity(threadId, undefined);
  };
  const stopEvents = options.bridge.onEvent((frame) => {
    if (frame.kind === 'usage.updated' || frame.kind === 'thread.changed') return;
    if (frame.kind === 'agent-message.posted') {
      sessions.get(frame.message.from.threadId)?.handle(frame);
      sessions.get(frame.message.to.threadId)?.handle(frame);
      return;
    }
    sessions.get(frame.threadId)?.handle(frame);
  });
  const reloadAll = (): void => {
    for (const session of sessions.values()) void session.load();
  };
  let streamUp = true;
  const setStream = (up: boolean): void => {
    streamUp = up;
    for (const session of sessions.values()) session.setStream(up);
  };
  const stopRestarts = options.bridge.onHostReady(() => {
    setStream(true);
  });
  const stopLost = options.bridge.onHostLost(() => {
    setStream(false);
  });
  return {
    activity,
    session: (threadId) => {
      const existing = sessions.get(threadId);
      if (existing !== undefined) return existing;
      const session = openThreadSession({
        api: options.api,
        bridge: options.bridge,
        threadId,
        onFinished: (message) => options.onFinished?.(threadId, message),
        onGroupsChanged: () => {
          for (const other of sessions.values()) if (other.threadId !== threadId) void other.load();
          options.onGroupsChanged?.();
        },
        drafts,
        ...(options.blockedRefreshMs === undefined ? {} : { blockedRefreshMs: options.blockedRefreshMs }),
        ...(options.reconnectMs === undefined ? {} : { reconnectMs: options.reconnectMs }),
      });
      sessions.set(threadId, session);
      watch(session);
      if (!streamUp) session.setStream(false);
      void session.load();
      return session;
    },
    reloadAll,
    detach: (threadId) => {
      sessions.get(threadId)?.close();
      sessions.delete(threadId);
      stopWatching(threadId);
    },
    forget: (threadId) => {
      drafts.write(threadId, '');
      sessions.get(threadId)?.close();
      sessions.delete(threadId);
      stopWatching(threadId);
    },
    close: () => {
      stopEvents();
      stopRestarts();
      stopLost();
      for (const session of sessions.values()) {
        session.close();
        stopWatching(session.threadId);
      }
      sessions.clear();
    },
  };
}
