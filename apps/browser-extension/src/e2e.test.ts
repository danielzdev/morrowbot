import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standaloneRuntime } from '@morrowbot/plugin-sdk';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startBridge, type Bridge } from '../../../plugins/browser/src/bridge.ts';
import type { SecretSource } from '../../../plugins/browser/src/secrets.ts';
import type { ToolOutput } from '../../../plugins/browser/src/tool.ts';
import { browserTools, callTool } from '../../../plugins/browser/src/tools.ts';
import { createCdpDriver } from './cdp/driver.ts';
import { startConnection, type Connection, type ConnectionDeps, type ConnectionStatus } from './core/connection.ts';
import { chromeMissing, launchChrome, type ChromeUnderTest } from './testing/chrome.ts';
import { servePages } from './testing/pages.ts';

const TOKEN = 'e2e-token-e2e-token-e2e-token-e2e-token';
const INSTANCE = 'e2e-instance-0001';
const TEST_TIMEOUT_MS = 60_000;
let chrome: ChromeUnderTest | undefined;
let pages: Awaited<ReturnType<typeof servePages>> | undefined;
let bridge: Bridge | undefined;
let connection: Connection | undefined;
const statuses: ConnectionStatus['kind'][] = [];
const vault: SecretSource = () => Promise.resolve({ kind: 'value', value: 'pw-e2e' });

function ready<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not started`);
  return value;
}

const nodeSocket: ConnectionDeps['openSocket'] = (url, protocols, handlers) => {
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
};

beforeAll(async () => {
  if (chromeMissing) return;
  chrome = await launchChrome();
  pages = await servePages();
  bridge = await startBridge({ serve: standaloneRuntime().serveLoopback, port: 0, pairingToken: TOKEN });
  const { port } = bridge;
  connection = startConnection({
    pairing: () => Promise.resolve({ port, token: TOKEN, instanceId: INSTANCE }),
    openSocket: nodeSocket,
    driver: createCdpDriver({ tabs: chrome.tabs, attach: chrome.attach, takeoverUi: { show: () => Promise.resolve(), hide: () => Promise.resolve() } }),
    browser: { family: 'chromium', name: 'Chrome', version: 'test' },
    extensionVersion: '0.1.0',
    onStatus: (status) => statuses.push(status.kind),
  });
}, 90_000);

afterAll(async () => {
  if (chromeMissing) return;
  connection?.stop();
  await Promise.allSettled([bridge?.close(), chrome?.close(), pages?.close()]);
}, 90_000);

const text = (output: ToolOutput): string =>
  output.kind === 'image' ? `image ${output.mimeType}` : `${output.kind}: ${output.text}`.replaceAll(String(ready(pages, 'pages').port), '<port>');

it.skipIf(chromeMissing)(
  'an agent fills and submits a login form through the plugin, the extension and a real Chrome',
  async () => {
    const activeBridge = ready(bridge, 'bridge');
    const activeChrome = ready(chrome, 'chrome');
    const activePages = ready(pages, 'pages');
    await activeBridge.whenConnected(null, 15_000);
    const tools = browserTools({ bridge: activeBridge, uploads: { kind: 'off' } });
    const tool = async (name: string, input: unknown): Promise<string> => text(await callTool(tools, name, input, { signal: new AbortController().signal, secrets: vault }));

    const opened = await tool('browser_open_tab', { url: activePages.url('form') });
    const tabId = Number(/Tab (\d+)/.exec(opened)?.[1]);
    const snapshot = await tool('browser_snapshot', { tabId });
    const steps = [
      await tool('browser_type', { tabId, ref: 'e3', text: 'ada@example.com' }),
      await tool('browser_fill_secret', { tabId, ref: 'e4', secret: { vaultId: 'demo', field: 'password' } }),
      await tool('browser_select_option', { tabId, ref: 'e6', values: ['pro'] }),
      await tool('browser_click', { tabId, ref: 'e10' }),
      await tool('browser_screenshot', { tabId }),
    ];
    expect(JSON.stringify({ opened, snapshot, steps, after: await tool('browser_snapshot', { tabId }) })).not.toContain('pw-e2e');
    const anyTab = (line: string): string => line.replaceAll(`Tab ${String(tabId)}:`, 'Tab <tab>:');
    expect({
      statuses,
      opened: anyTab(opened),
      snapshot: anyTab(snapshot),
      steps,
      page: await activeChrome.evaluate(tabId, "document.getElementById('log').textContent"),
    }).toMatchInlineSnapshot(`
      {
        "opened": "text: Opened.
      Tab <tab>: Sign in — http://127.0.0.1:<port>/form",
        "page": "submitted ada@example.com remember=false plan=pro password-length=6",
        "snapshot": "text: Tab <tab>: Sign in — http://127.0.0.1:<port>/form
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
          "text: Filled the password of vault login demo into e4.",
          "text: Selected in e6.",
          "text: Clicked e10.",
          "image image/png",
        ],
      }
    `);
  },
  TEST_TIMEOUT_MS,
);

it.skipIf(chromeMissing)(
  'the extension reconnects when Ori Kami restarts',
  async () => {
    const activeBridge = ready(bridge, 'bridge');
    const { port } = activeBridge;
    await activeBridge.close();
    bridge = await startBridge({ serve: standaloneRuntime().serveLoopback, port, pairingToken: TOKEN });
    const link = await bridge.whenConnected(null, 15_000);
    await vi.waitFor(
      () => {
        expect(statuses.at(-1)).toBe('connected');
      },
      { timeout: 15_000 },
    );
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
  },
  TEST_TIMEOUT_MS,
);

it.skipIf(chromeMissing)(
  'the extension keeps retrying when its pairing cannot be read',
  async () => {
    const activeBridge = ready(bridge, 'bridge');
    const activeChrome = ready(chrome, 'chrome');
    const seen: string[] = [];
    let reads = 0;
    const second = startConnection({
      pairing: () => (reads++ === 0 ? Promise.reject(new Error('storage is busy')) : Promise.resolve({ port: activeBridge.port, token: TOKEN, instanceId: 'e2e-instance-0002' })),
      openSocket: nodeSocket,
      driver: createCdpDriver({ tabs: activeChrome.tabs, attach: activeChrome.attach, takeoverUi: { show: () => Promise.resolve(), hide: () => Promise.resolve() } }),
      browser: { family: 'chromium', name: 'Chrome', version: 'test' },
      extensionVersion: '0.1.0',
      onStatus: (status) => seen.push(status.kind === 'waiting' ? `waiting: ${status.reason}` : status.kind),
    });
    try {
      await vi.waitFor(
        () => {
          expect(seen.at(-1)).toBe('connected');
        },
        { timeout: 15_000 },
      );
      expect(seen).toMatchInlineSnapshot(`
        [
          "waiting: Could not read the pairing: storage is busy",
          "connecting",
          "connected",
        ]
      `);
    } finally {
      second.stop();
    }
  },
  TEST_TIMEOUT_MS,
);

it.skipIf(chromeMissing)(
  'an agent uploads only files inside the folder the person chose',
  async () => {
    const activeBridge = ready(bridge, 'bridge');
    const activeChrome = ready(chrome, 'chrome');
    const activePages = ready(pages, 'pages');
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-uploads-')));
    try {
      await mkdir(path.join(root, 'allowed'));
      await writeFile(path.join(root, 'allowed', 'cv.pdf'), 'cv');
      await writeFile(path.join(root, 'secret.key'), 'key');
      await symlink(path.join(root, 'secret.key'), path.join(root, 'allowed', 'sneaky.pdf'));
      const off = browserTools({ bridge: activeBridge, uploads: { kind: 'off' } });
      const on = browserTools({ bridge: activeBridge, uploads: { kind: 'folder', path: path.join(root, 'allowed') } });
      const opened = text(await callTool(on, 'browser_open_tab', { url: activePages.url('form') }, { signal: new AbortController().signal, secrets: vault }));
      const tabId = Number(/Tab (\d+)/.exec(opened)?.[1]);
      await callTool(on, 'browser_snapshot', { tabId }, { signal: new AbortController().signal, secrets: vault });
      const upload = async (tools: typeof on, paths: string[]): Promise<string> =>
        text(await callTool(tools, 'browser_upload_files', { tabId, ref: 'e9', paths }, { signal: new AbortController().signal, secrets: vault })).replaceAll(root, '<root>');
      expect({
        off: await upload(off, ['cv.pdf']),
        outside: await upload(on, [path.join(root, 'secret.key')]),
        climbing: await upload(on, ['../secret.key']),
        symlink: await upload(on, ['sneaky.pdf']),
        inside: await upload(on, ['cv.pdf']),
        page: await activeChrome.evaluate(tabId, "document.getElementById('log').textContent"),
      }).toMatchInlineSnapshot(`
        {
          "climbing": "error: ../secret.key is not inside the upload folder <root>/allowed.",
          "inside": "text: Attached 1 file(s).",
          "off": "error: Uploads are off. Ask the person to choose an upload folder in the Browser plugin settings.",
          "outside": "error: <root>/secret.key is not inside the upload folder <root>/allowed.",
          "page": "file cv.pdf",
          "symlink": "error: sneaky.pdf is not inside the upload folder <root>/allowed.",
        }
      `);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
