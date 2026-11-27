import type { Thread } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { z } from 'zod';
import { readPref, writePref } from '../../shared/local-pref.ts';
import { afterClose, tabsOf, type Tabs } from './tabs.ts';

const TABS_KEY = 'morrowbot.thread.tabs';
const Kept = z.record(z.string(), z.array(z.string()));

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

/** Each agent's open tabs, kept per window across restarts. `loaded` is false while the chats load, so a short list never drops saved tabs. */
export function useTabs(agentId: string, threads: readonly Thread[], loaded: boolean, openId: string | null, onOpen: (threadId: string) => void) {
  const [kept, setKept] = useState<Readonly<Record<string, string[]>>>(() => readPref<Record<string, string[]>>(TABS_KEY, Kept, {}));
  const tabs: Tabs = tabsOf(threads, kept[agentId] ?? [], openId);
  const shown = tabs.others.map(({ id }) => id);
  const save = (ids: string[]): void => {
    const next = { ...kept, [agentId]: ids };
    setKept(next);
    writePref(TABS_KEY, next);
  };
  useEffect(() => {
    if (loaded && !same(shown, kept[agentId] ?? [])) save(shown);
  });
  return {
    tabs,
    close: (threadId: string): void => {
      save(shown.filter((id) => id !== threadId));
      const next = afterClose(tabs, threadId);
      if (threadId === openId && next !== null) onOpen(next);
    },
    closeOthers: (threadId: string): void => {
      save(shown.filter((id) => id === threadId));
      if (openId !== threadId && openId !== tabs.main?.id) onOpen(threadId);
    },
  };
}
