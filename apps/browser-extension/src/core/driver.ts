import type { BrowserCommand, BrowserCommandKind, BrowserEvent, BrowserResult, BrowserTab, BrowserTabId } from '@morrowbot/contracts';

/**
 * What a browser extension does with bridge commands. The connection to the plugin knows only
 * this, so a Firefox or Safari extension reuses `core/` with its own driver.
 */
export interface BrowserDriver {
  /** The commands this driver answers; sent in `hello`. */
  readonly commands: readonly BrowserCommandKind[];
  run(command: BrowserCommand): Promise<BrowserResult>;
  onEvent(listener: (event: BrowserEvent) => void): void;
}

/** The browser's tabs, as the WebExtension `tabs` API gives them. */
export interface TabsApi {
  list(): Promise<BrowserTab[]>;
  /** Throws `BrowserFailure('no-such-tab')` for a tab that is gone. */
  get(tabId: BrowserTabId): Promise<BrowserTab>;
  /** Opens a blank tab without making it active or raising its window. */
  createInBackground(): Promise<BrowserTab>;
  activate(tabId: BrowserTabId, focusWindow: boolean): Promise<void>;
  close(tabId: BrowserTabId): Promise<void>;
}
