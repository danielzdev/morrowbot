import type { AssistantMessage } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { Store } from '../../shared/store.ts';
import { COMPLETED_MS, nextActivity, type ChatActivity } from './activity.ts';
import { openThreadSession, type ThreadSession } from './thread-session.ts';

/** The open chats. Each keeps its draft while the user switches tabs, and all reload after a host restart. */
export interface ChatHub {
  /** What each open chat is doing; a chat that is not open is idle. */
  readonly activity: Store<Readonly<Record<string, ChatActivity>>>;
  /** The chat's session, opened and loaded on first use. */
  session(threadId: string): ThreadSession;
  /** Loads every open chat again, e.g. after a process group was released elsewhere. */
  reloadAll(): void;
  forget(threadId: string): void;
  close(): void;
}

export interface ChatHubOptions {
  readonly api: Api;
  readonly bridge: Pick<MorrowbotBridge, 'subscribe' | 'unsubscribe' | 'onEvent' | 'onHostReady'>;
  readonly onFinished?: (threadId: string, message: AssistantMessage) => void;
  readonly onGroupsChanged?: () => void;
  readonly blockedRefreshMs?: number;
  readonly completedMs?: number;
}

export function createChatHub(options: ChatHubOptions): ChatHub {
  const sessions = new Map<string, ThreadSession>();
  const watching = new Map<string, () => void>();
  const completed = new Map<string, ReturnType<typeof setTimeout>>();
  const activity = new Store<Readonly<Record<string, ChatActivity>>>({});
  const setActivity = (threadId: string, next: ChatActivity | undefined): void => {
    if (activity.get()[threadId] === next) return;
    activity.update((current) => {
      const others = Object.fromEntries(Object.entries(current).filter(([key]) => key !== threadId));
      return next === undefined ? others : { ...others, [threadId]: next };
    });
  };
  const settle = (threadId: string): void => {
    clearTimeout(completed.get(threadId));
    completed.delete(threadId);
  };
  const watch = (session: ThreadSession): void => {
    const { threadId } = session;
    watching.set(
      threadId,
      session.screen.subscribe(({ view }) => {
        if (view.kind !== 'loaded') return;
        const next = nextActivity(activity.get()[threadId], view.value);
        if (next !== 'completed') settle(threadId);
        else if (!completed.has(threadId)) {
          completed.set(
            threadId,
            setTimeout(() => {
              completed.delete(threadId);
              setActivity(threadId, 'idle');
            }, options.completedMs ?? COMPLETED_MS),
          );
        }
        setActivity(threadId, next);
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
    if (frame.kind === 'usage.updated') return;
    sessions.get(frame.threadId)?.handle(frame);
  });
  const reloadAll = (): void => {
    for (const session of sessions.values()) void session.load();
  };
  const stopRestarts = options.bridge.onHostReady(reloadAll);
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
        ...(options.blockedRefreshMs === undefined ? {} : { blockedRefreshMs: options.blockedRefreshMs }),
      });
      sessions.set(threadId, session);
      watch(session);
      void session.load();
      return session;
    },
    reloadAll,
    forget: (threadId) => {
      sessions.get(threadId)?.close();
      sessions.delete(threadId);
      stopWatching(threadId);
    },
    close: () => {
      stopEvents();
      stopRestarts();
      for (const session of sessions.values()) {
        session.close();
        stopWatching(session.threadId);
      }
      sessions.clear();
    },
  };
}
