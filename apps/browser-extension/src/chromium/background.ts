import { createCdpDriver } from '../cdp/driver.ts';
import { startConnection, type ConnectionStatus } from '../core/connection.ts';
import { loadPairing, PAIRING_KEY } from '../core/pairing.ts';
import { detectBrowser } from './browser-name.ts';
import { chromeDebugger } from './debugger.ts';
import { chromeOverlay, TakeoverFinished } from './overlay.ts';
import { chromeTabs } from './tabs.ts';

const KEEPALIVE = 'morrowbot-keepalive';

const debuggerApi = chromeDebugger((tabId) => {
  driver.detached(tabId);
});
const driver = createCdpDriver({ tabs: chromeTabs, attach: debuggerApi.attach, takeoverUi: chromeOverlay });

const showStatus = (status: ConnectionStatus): void => {
  void chrome.storage.session.set({ status });
  const text = status.kind === 'connected' ? '' : '!';
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color: '#d14' });
};

const connection = startConnection({
  pairing: () => loadPairing(chrome.storage.local),
  openSocket: (url, protocols, handlers) => {
    const socket = new WebSocket(url, protocols);
    socket.onopen = () => {
      handlers.open();
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') handlers.message(event.data);
    };
    socket.onclose = (event) => {
      handlers.close(event.code, event.reason);
    };
    return {
      isOpen: () => socket.readyState === WebSocket.OPEN,
      send: (text) => {
        socket.send(text);
      },
      close: (code, reason) => {
        socket.close(code, reason);
      },
    };
  },
  driver,
  browser: detectBrowser(),
  extensionVersion: chrome.runtime.getManifest().version,
  onStatus: showStatus,
});

chrome.tabs.onRemoved.addListener((tabId) => {
  driver.takeovers.tabClosed(tabId);
  driver.closed(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void driver.takeovers.tabLoaded(tabId);
});

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  const parsed = TakeoverFinished.safeParse(raw);
  if (parsed.success && sender.tab?.id !== undefined && driver.takeovers.activeOn(sender.tab.id)?.takeoverId === parsed.data.takeoverId) {
    void driver.takeovers.finish(parsed.data.takeoverId, parsed.data.outcome);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && PAIRING_KEY in changes) connection.reconnect();
});

void chrome.alarms.create(KEEPALIVE, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE && !connection.active) connection.reconnect();
});
