import { standaloneRuntime } from '@morrowbot/plugin-sdk';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startBridge, type Bridge } from '../../../plugins/browser/src/bridge.ts';
import type { SecretSource } from '../../../plugins/browser/src/secrets.ts';
import type { ToolOutput } from '../../../plugins/browser/src/tool.ts';
import { browserTools, callTool } from '../../../plugins/browser/src/tools.ts';
import { createCdpDriver } from './cdp/driver.ts';
import { startConnection, type Connection, type ConnectionStatus } from './core/connection.ts';
import { chromeMissing, launchChrome, type ChromeUnderTest } from './testing/chrome.ts';
import { servePages } from './testing/pages.ts';

const TOKEN = 'e2e-token-e2e-token-e2e-token-e2e-token';
let chrome: ChromeUnderTest;
let pages: Awaited<ReturnType<typeof servePages>>;
let bridge: Bridge;
let connection: Connection;
const statuses: ConnectionStatus['kind'][] = [];
const vault: SecretSource = { resolve: () => Promise.resolve({ kind: 'value', value: 'pw-e2e' }) };

beforeAll(async () => {
  if (chromeMissing) return;
  chrome = await launchChrome();
  pages = await servePages();
  bridge = await startBridge({ serve: standaloneRuntime().serveLoopback, port: 0, pairingToken: TOKEN });
  const { port } = bridge;
  connection = startConnection({
    pairing: () => Promise.resolve({ port, token: TOKEN }),
    openSocket: (url, protocols, handlers) => {
      const socket = new WebSocket(url, protocols, { origin: 'chrome-extension://morrowbot-test' });
      socket.on('open', () => {
        handlers.open();
      });
      socket.on('message', (data: Buffer) => {
        handlers.message(data.toString('utf8'));
      });
      socket.on('close', (code: number, reason: Buffer) => {
        handlers.close(code, reason.toString('utf8'));
      });
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
    driver: createCdpDriver({ tabs: chrome.tabs, attach: chrome.attach, takeoverUi: { show: () => Promise.resolve(), hide: () => Promise.resolve() } }),
    browser: { family: 'chromium', name: 'Chrome', version: 'test' },
    extensionVersion: '0.1.0',
    onStatus: (status) => statuses.push(status.kind),
  });
}, 30_000);

afterAll(async () => {
  if (chromeMissing) return;
  connection.stop();
  await bridge.close();
  await chrome.close();
  await pages.close();
});

const text = (output: ToolOutput): string => (output.kind === 'image' ? `image ${output.mimeType}` : `${output.kind}: ${output.text}`.replaceAll(String(pages.port), '<port>'));

it.skipIf(chromeMissing)('an agent fills and submits a login form through the plugin, the extension and a real Chrome', async () => {
  await bridge.whenConnected(null, 5000);
  const tools = browserTools({ bridge, secrets: vault });
  const tool = async (name: string, input: unknown): Promise<string> => text(await callTool(tools, name, input, new AbortController().signal));

  const opened = await tool('browser_open_tab', { url: pages.url('form') });
  const tabId = Number(/Tab (\d+)/.exec(opened)?.[1]);
  const snapshot = await tool('browser_snapshot', { tabId });
  const steps = [
    await tool('browser_type', { tabId, ref: 'e3', text: 'ada@example.com' }),
    await tool('browser_fill_secret', { tabId, ref: 'e4', secret: { entryId: 'demo', field: 'password' } }),
    await tool('browser_select_option', { tabId, ref: 'e6', values: ['pro'] }),
    await tool('browser_click', { tabId, ref: 'e10' }),
    await tool('browser_screenshot', { tabId }),
  ];
  expect(JSON.stringify({ opened, snapshot, steps, after: await tool('browser_snapshot', { tabId }) })).not.toContain('pw-e2e');
  expect({ statuses, opened, snapshot, steps, page: await chrome.evaluate(tabId, "document.getElementById('log').textContent") }).toMatchInlineSnapshot(`
    {
      "opened": "text: Opened.
    Tab 2: Sign in — http://127.0.0.1:<port>/form",
      "page": "submitted ada@example.com remember=false plan=pro password-length=6",
      "snapshot": "text: Tab 2: Sign in — http://127.0.0.1:<port>/form
    - heading "Sign in" [ref=e1] [level=1]
    - form [ref=e2]
      - textbox "Email" [ref=e3]
      - textbox "Password" [ref=e4] value=""
      - checkbox "Remember me" [ref=e5]
      - combobox "Plan" [ref=e6] value="Free"
        - option "Free" [ref=e7] [selected]
        - option "Pro" [ref=e8]
      - button "Avatar" [ref=e9]
      - button "Continue" [ref=e10]
    - status [ref=e11]",
      "statuses": [
        "connecting",
        "connected",
      ],
      "steps": [
        "text: Typed into e3.",
        "text: Filled the password of vault entry demo into e4.",
        "text: Selected in e6.",
        "text: Clicked e10.",
        "image image/png",
      ],
    }
  `);
});

it.skipIf(chromeMissing)('the extension reconnects when MorrowBot restarts', async () => {
  const { port } = bridge;
  await bridge.close();
  bridge = await startBridge({ serve: standaloneRuntime().serveLoopback, port, pairingToken: TOKEN });
  const link = await bridge.whenConnected(null, 10_000);
  await vi.waitFor(() => {
    expect(statuses.at(-1)).toBe('connected');
  });
  expect({ browserId: link.browserId, statuses: statuses.slice(2) }).toMatchInlineSnapshot(`
    {
      "browserId": "chrome-1",
      "statuses": [
        "waiting",
        "connecting",
        "connected",
      ],
    }
  `);
});
