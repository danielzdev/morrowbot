import { afterAll, beforeAll } from 'vitest';
import type { BrowserCommand, BrowserEvent, BrowserResult } from '@morrowbot/contracts';
import { createCdpDriver, type CdpDriver } from '../cdp/driver.ts';
import { launchChrome, type ChromeUnderTest } from './chrome.ts';
import { servePages } from './pages.ts';

/** A Chromium driver on a real headless Chrome and the test pages, for one test file. */
export interface DriverUnderTest {
  readonly chrome: ChromeUnderTest;
  readonly pages: Awaited<ReturnType<typeof servePages>>;
  readonly driver: CdpDriver;
  readonly events: BrowserEvent[];
  readonly banners: string[];
  run(command: BrowserCommand): Promise<BrowserResult>;
  /** Opens `page` in a new tab and returns the tab id and a snapshot's tree. */
  open(page: string): Promise<{ readonly tabId: number; readonly tree: string }>;
  tree(tabId: number): Promise<string>;
  /** The text of the page's `#log`. */
  log(tabId: number): Promise<unknown>;
}

export function driverUnderTest(): DriverUnderTest {
  let chrome: ChromeUnderTest | undefined;
  let pages: Awaited<ReturnType<typeof servePages>> | undefined;
  let driver: CdpDriver | undefined;
  const events: BrowserEvent[] = [];
  const banners: string[] = [];
  const ready = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('Chrome is not started yet');
    return value;
  };

  beforeAll(async () => {
    chrome = await launchChrome();
    pages = await servePages();
    driver = createCdpDriver({
      tabs: chrome.tabs,
      attach: async (tabId) => {
        const session = await ready(chrome).attach(tabId);
        return {
          on: (method, listener) => session.on(method, (params) => {
            if (method.startsWith('Input.') || method.startsWith('Page.javascript')) console.log('DIAG event', method, JSON.stringify(params).slice(0, 200));
            listener(params);
          }),
          send: async (method, params) => {
            const started = Date.now();
            try {
              const answer = await session.send(method, params);
              console.log('DIAG', Date.now() - started, 'ms', method, JSON.stringify(params ?? {}).slice(0, 160), JSON.stringify(answer).slice(0, 200));
              return answer;
            } catch (error) {
              console.log('DIAG FAIL', Date.now() - started, 'ms', method, String(error));
              throw error;
            }
          },
        };
      },
      takeoverUi: {
        show: (tabId, view) => {
          banners.push(`show ${String(tabId)} ${view.reason}: ${view.message}`);
          return Promise.resolve();
        },
        hide: (tabId) => {
          banners.push(`hide ${String(tabId)}`);
          return Promise.resolve();
        },
      },
    });
    driver.onEvent((event) => events.push(event));
  }, 90_000);

  afterAll(async () => {
    await chrome?.close();
    await pages?.close();
  });

  const harness: DriverUnderTest = {
    get chrome() {
      return ready(chrome);
    },
    get pages() {
      return ready(pages);
    },
    get driver() {
      return ready(driver);
    },
    events,
    banners,
    run: (command) => ready(driver).run(command),
    open: async (page) => {
      const opened = await harness.run({ kind: 'open-tab', url: ready(pages).url(page) });
      if (opened.kind !== 'ok' || opened.value.kind !== 'tab') throw new Error(JSON.stringify(opened));
      return { tabId: opened.value.tab.tabId, tree: await harness.tree(opened.value.tab.tabId) };
    },
    tree: async (tabId) => {
      const snapshot = await harness.run({ kind: 'snapshot', tabId });
      if (snapshot.kind !== 'ok' || snapshot.value.kind !== 'snapshot') throw new Error(JSON.stringify(snapshot));
      return snapshot.value.tree;
    },
    log: (tabId) => ready(chrome).evaluate(tabId, "document.getElementById('log').textContent"),
  };
  return harness;
}

/** The ref on the snapshot line that mentions `label`. */
export function refOf(snapshotTree: string, label: string): string {
  const line = snapshotTree.split('\n').find((candidate) => candidate.includes(label) && candidate.includes('[ref='));
  const ref = /\[ref=(e\d+)\]/.exec(line ?? '')?.[1];
  if (ref === undefined) throw new Error(`No ref for ${label} in:\n${snapshotTree}`);
  return ref;
}
