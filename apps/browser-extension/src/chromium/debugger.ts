import type { BrowserTabId } from '@morrowbot/contracts';
import { BrowserFailure, type CdpSession } from '../cdp/session.ts';

type Listener = (params: unknown) => void;

/** `chrome.debugger` as one `CdpSession` per tab. `onDetached` hears the tab close or the person cancel debugging. */
export function chromeDebugger(onDetached: (tabId: BrowserTabId) => void): { readonly attach: (tabId: BrowserTabId) => Promise<CdpSession> } {
  const listeners = new Map<BrowserTabId, Map<string, Set<Listener>>>();
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined) return;
    for (const listener of listeners.get(source.tabId)?.get(method) ?? []) listener(params);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === undefined) return;
    listeners.delete(source.tabId);
    onDetached(source.tabId);
  });
  return {
    attach: async (tabId) => {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/another debugger/i.test(message)) throw new BrowserFailure('failed', 'DevTools or another debugger is attached to this tab. Close it and try again.');
        throw new BrowserFailure('restricted-page', `The browser does not let extensions control this page (${message}).`);
      }
      const events = new Map<string, Set<Listener>>();
      listeners.set(tabId, events);
      return {
        send: (method, params) => chrome.debugger.sendCommand({ tabId }, method, { ...params }),
        on: (method, listener) => {
          const set = events.get(method) ?? new Set();
          set.add(listener);
          events.set(method, set);
          return () => set.delete(listener);
        },
      };
    },
  };
}
