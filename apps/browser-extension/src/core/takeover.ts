import type { BrowserEvent, BrowserTabId, TakeoverReason } from '@morrowbot/contracts';

export interface TakeoverView {
  readonly takeoverId: string;
  readonly reason: TakeoverReason;
  readonly message: string;
}

/** How the person sees a takeover: a banner on the page with Done and Cancel. */
export interface TakeoverUi {
  show(tabId: BrowserTabId, view: TakeoverView): Promise<void>;
  hide(tabId: BrowserTabId): Promise<void>;
}

export interface Takeovers {
  activeOn(tabId: BrowserTabId): TakeoverView | undefined;
  start(tabId: BrowserTabId, view: TakeoverView): Promise<void>;
  /** The person pressed Done or Cancel on the banner. */
  finish(takeoverId: string, outcome: 'done' | 'cancelled'): Promise<void>;
  /** The agent stopped waiting; no event, the plugin already knows. */
  end(tabId: BrowserTabId, takeoverId: string): Promise<void>;
  tabClosed(tabId: BrowserTabId): void;
  /** The tab loaded a new page, which dropped the banner. */
  tabLoaded(tabId: BrowserTabId): Promise<void>;
}

/** One takeover per tab at a time. Agent commands on a tab under takeover are refused by the driver. */
export function createTakeovers(ui: TakeoverUi, emit: (event: BrowserEvent) => void): Takeovers {
  const active = new Map<BrowserTabId, TakeoverView>();
  const tabOf = (takeoverId: string): BrowserTabId | undefined => [...active].find(([, view]) => view.takeoverId === takeoverId)?.[0];
  return {
    activeOn: (tabId) => active.get(tabId),
    start: async (tabId, view) => {
      await ui.show(tabId, view);
      active.set(tabId, view);
    },
    finish: async (takeoverId, outcome) => {
      const tabId = tabOf(takeoverId);
      if (tabId === undefined) return;
      active.delete(tabId);
      emit({ kind: 'takeover-ended', tabId, takeoverId, outcome });
      await ui.hide(tabId);
    },
    end: async (tabId, takeoverId) => {
      if (active.get(tabId)?.takeoverId !== takeoverId) return;
      active.delete(tabId);
      await ui.hide(tabId);
    },
    tabClosed: (tabId) => {
      const view = active.get(tabId);
      if (view === undefined) return;
      active.delete(tabId);
      emit({ kind: 'takeover-ended', tabId, takeoverId: view.takeoverId, outcome: 'tab-closed' });
    },
    tabLoaded: async (tabId) => {
      const view = active.get(tabId);
      if (view !== undefined) await ui.show(tabId, view);
    },
  };
}
