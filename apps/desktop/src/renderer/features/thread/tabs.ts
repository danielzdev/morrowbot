import { mainThread, type Thread } from '@morrowbot/contracts';

/** The header's tabs: the agent's main chat (its first, shown under the agent's name and never closed), then the other open chats. */
export interface Tabs {
  readonly main: Thread | null;
  readonly others: readonly Thread[];
}

/** `kept` is the saved tab order; the chat on screen joins at the end when it is not kept yet. Deleted chats drop out. */
export function tabsOf(threads: readonly Thread[], kept: readonly string[], openId: string | null): Tabs {
  const main = mainThread(threads);
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const ids = openId === null || kept.includes(openId) ? kept : [...kept, openId];
  const others = ids.flatMap((id) => {
    const thread = byId.get(id);
    return thread === undefined || thread.id === main?.id ? [] : [thread];
  });
  return { main, others };
}

/** The chat to show after closing `closedId`: the tab to its left, or the main chat. */
export function afterClose(tabs: Tabs, closedId: string): string | null {
  const index = tabs.others.findIndex(({ id }) => id === closedId);
  return (index > 0 ? tabs.others[index - 1]?.id : undefined) ?? tabs.main?.id ?? null;
}
