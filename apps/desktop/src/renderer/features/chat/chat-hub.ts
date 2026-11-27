import type { AssistantMessage } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../../bridge.ts';
import type { Api } from '../../shared/api.ts';
import { openThreadSession, type ThreadSession } from './thread-session.ts';

/** The open chats. Each keeps its draft while the user switches tabs, and all reload after a host restart. */
export interface ChatHub {
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
}

export function createChatHub(options: ChatHubOptions): ChatHub {
  const sessions = new Map<string, ThreadSession>();
  const stopEvents = options.bridge.onEvent((frame) => {
    if (frame.kind === 'usage.updated') return;
    sessions.get(frame.threadId)?.handle(frame);
  });
  const reloadAll = (): void => {
    for (const session of sessions.values()) void session.load();
  };
  const stopRestarts = options.bridge.onHostReady(reloadAll);
  return {
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
      void session.load();
      return session;
    },
    reloadAll,
    forget: (threadId) => {
      sessions.get(threadId)?.close();
      sessions.delete(threadId);
    },
    close: () => {
      stopEvents();
      stopRestarts();
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}
