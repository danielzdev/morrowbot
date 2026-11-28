import type { BrowserTab } from '@morrowbot/contracts';
import type { TabsApi } from '../core/driver.ts';
import { BrowserFailure } from '../cdp/session.ts';

function toTab(tab: chrome.tabs.Tab): BrowserTab[] {
  if (tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) return [];
  return [{ tabId: tab.id, windowId: tab.windowId, url: tab.url ?? tab.pendingUrl ?? '', title: tab.title ?? '', active: tab.active, status: tab.status === 'loading' ? 'loading' : 'complete' }];
}

function only(tab: chrome.tabs.Tab | undefined, tabId: number): BrowserTab {
  const [found] = tab === undefined ? [] : toTab(tab);
  if (found === undefined) throw new BrowserFailure('no-such-tab', `No tab ${String(tabId)}.`);
  return found;
}

/** `chrome.tabs`. New tabs open in the background; only `activate` with `focusWindow` raises a window. */
export const chromeTabs: TabsApi = {
  list: async () => (await chrome.tabs.query({})).flatMap(toTab),
  get: async (tabId) => {
    try {
      return only(await chrome.tabs.get(tabId), tabId);
    } catch {
      throw new BrowserFailure('no-such-tab', `No tab ${String(tabId)}.`);
    }
  },
  createInBackground: async () => {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    return only(tab, -1);
  },
  activate: async (tabId, focusWindow) => {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (focusWindow && tab !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  },
  close: (tabId) => chrome.tabs.remove(tabId),
};
