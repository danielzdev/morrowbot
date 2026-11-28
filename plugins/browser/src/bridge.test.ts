import {
  BROWSER_BRIDGE_SUBPROTOCOL,
  LOOPBACK_TOKEN_PREFIX,
  PluginBridgeMessage,
  type BrowserCommand,
  type BrowserCommandKind,
  type BrowserResult,
  type BrowserTab,
  type ExtensionMessage,
} from '@morrowbot/contracts';
import { standaloneRuntime } from '@morrowbot/plugin-sdk';
import { afterEach, expect, it } from 'vitest';
import { startBridge, type Bridge } from './bridge.ts';
import { secretTools } from './secret-tools.ts';
import { noSecretSource, type SecretSource } from './secrets.ts';
import { browserTools, callTool } from './tools.ts';
import type { BrowserTool, ToolOutput } from './tool.ts';

const TOKEN = 'x'.repeat(43);
let bridge: Bridge | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await bridge?.close();
  bridge = undefined;
});

async function start(helloTimeoutMs = 5000): Promise<Bridge> {
  bridge = await startBridge({ serve: standaloneRuntime().serveLoopback, port: 0, pairingToken: TOKEN, helloTimeoutMs });
  return bridge;
}

/** A stand-in extension speaking the bridge protocol by hand. */
interface FakeExtension {
  send(message: ExtensionMessage | string): void;
  next(): Promise<PluginBridgeMessage>;
  readonly closed: Promise<string>;
  close(): void;
}

async function connect(port: number): Promise<FakeExtension> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/`, {
    protocols: [BROWSER_BRIDGE_SUBPROTOCOL, `${LOOPBACK_TOKEN_PREFIX}${TOKEN}`],
    headers: { origin: 'chrome-extension://fake' },
  });
  sockets.push(socket);
  const inbox: PluginBridgeMessage[] = [];
  let wake: () => void = () => undefined;
  const closed = Promise.withResolvers<string>();
  socket.onmessage = (event: MessageEvent) => {
    inbox.push(PluginBridgeMessage.parse(JSON.parse(String(event.data))));
    wake();
  };
  socket.onclose = (event) => {
    closed.resolve(`${String(event.code)} ${event.reason}`);
  };
  await new Promise((resolve) => (socket.onopen = resolve));
  return {
    send: (message) => {
      socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    },
    next: async () => {
      while (inbox.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const message = inbox.shift();
      if (message === undefined) throw new Error('empty inbox');
      return message;
    },
    closed: closed.promise,
    close: () => {
      socket.close();
    },
  };
}

function hello(name: string, commands: BrowserCommandKind[], instanceId = `${name.toLowerCase()}-instance-0001`): ExtensionMessage {
  return { kind: 'hello', protocol: 1, browser: { family: 'chromium', name, version: '140' }, extensionVersion: '0.1.0', instanceId, commands };
}

async function greet(port: number, name: string, commands: BrowserCommandKind[]): Promise<FakeExtension> {
  const extension = await connect(port);
  extension.send(hello(name, commands));
  await extension.next();
  return extension;
}

/** Answers the next command with `answer(command)` and returns the command. */
async function answerNext(extension: FakeExtension, answer: (command: BrowserCommand) => BrowserResult): Promise<BrowserCommand> {
  const message = await extension.next();
  if (message.kind !== 'command') throw new Error(`expected a command, got ${message.kind}`);
  extension.send({ kind: 'result', id: message.id, result: answer(message.command) });
  return message.command;
}

const TAB: BrowserTab = { tabId: 7, windowId: 1, url: 'https://shop.example/login', title: 'Log in', active: false, status: 'complete' };
const tabs = (): BrowserResult => ({ kind: 'ok', value: { kind: 'tabs', tabs: [TAB] } });
const done = (): BrowserResult => ({ kind: 'ok', value: { kind: 'done' } });
const call = (tools: readonly BrowserTool[], name: string, input: unknown, signal = new AbortController().signal): Promise<ToolOutput> => callTool(tools, name, input, signal);

it('greets each browser with its own id and answers unlisted commands without asking', async () => {
  const started = await start();
  const tools = browserTools({ bridge: started, secrets: noSecretSource, uploads: { kind: 'off' } });
  const brave = await connect(started.port);
  brave.send(hello('Brave', ['list-tabs']));
  const welcome = await brave.next();
  const listing = call(tools, 'browser_tabs', {});
  await answerNext(brave, tabs);
  expect({
    welcome,
    tabs: await listing,
    click: await call(tools, 'browser_click', { tabId: 7, ref: 'e1' }),
    badInput: await call(tools, 'browser_open_tab', { url: 'file:///etc/passwd' }),
  }).toMatchInlineSnapshot(`
    {
      "badInput": {
        "kind": "error",
        "text": "Invalid input: ✖ Use an http or https URL
      → at url",
      },
      "click": {
        "kind": "error",
        "text": "Brave does not support click. (unsupported)",
      },
      "tabs": {
        "kind": "text",
        "text": "Browser brave-1 (Brave 140):
    Tab 7: Log in — https://shop.example/login",
      },
      "welcome": {
        "browserId": "brave-1",
        "kind": "welcome",
        "protocol": 1,
      },
    }
  `);
});

it('asks which browser when several are connected, and says when none is', async () => {
  const started = await start();
  const tools = browserTools({ bridge: started, secrets: noSecretSource, uploads: { kind: 'off' } });
  const none = await call(tools, 'browser_snapshot', { tabId: 1 });
  const { port } = started;
  await greet(port, 'Chrome', ['snapshot']);
  const edge = await greet(port, 'Edge', ['snapshot']);
  const ambiguous = await call(tools, 'browser_snapshot', { tabId: 1 });
  const chosen = call(tools, 'browser_snapshot', { tabId: 1, browser: 'edge-1' });
  const sent = await answerNext(edge, () => ({ kind: 'ok', value: { kind: 'snapshot', tab: TAB, tree: '- button "Pay" [ref=e1]', dialog: null } }));
  expect({ none, ambiguous, sent, chosen: await chosen }).toMatchInlineSnapshot(`
    {
      "ambiguous": {
        "kind": "error",
        "text": "Several browsers are connected (chrome-1, edge-1); say which with "browser".",
      },
      "chosen": {
        "kind": "text",
        "text": "Tab 7: Log in — https://shop.example/login
    - button "Pay" [ref=e1]",
      },
      "none": {
        "kind": "error",
        "text": "No browser is connected. Ask the person to install the MorrowBot browser extension and paste its pairing token into the Browser plugin settings.",
      },
      "sent": {
        "kind": "snapshot",
        "tabId": 1,
      },
    }
  `);
});

it('gives each installed extension back its own id when it reconnects, in any order', async () => {
  const started = await start();
  const join = async (instanceId: string): Promise<{ readonly extension: FakeExtension; readonly id: string }> => {
    const extension = await connect(started.port);
    extension.send(hello('Chrome', [], instanceId));
    const welcome = await extension.next();
    return { extension, id: welcome.kind === 'welcome' ? welcome.browserId : welcome.kind };
  };
  const work = await join('work-profile-0001');
  const home = await join('home-profile-0001');
  work.extension.close();
  home.extension.close();
  while (started.browsers().length > 0) await new Promise((resolve) => setTimeout(resolve, 10));
  const homeAgain = await join('home-profile-0001');
  const workAgain = await join('work-profile-0001');
  const workOnceMore = await join('work-profile-0001');
  expect({
    before: { work: work.id, home: home.id },
    after: { work: workAgain.id, home: homeAgain.id },
    duplicate: { id: workOnceMore.id, older: await workAgain.extension.closed, listed: started.browsers().map((link) => link.browserId) },
  }).toMatchInlineSnapshot(`
    {
      "after": {
        "home": "chrome-2",
        "work": "chrome-1",
      },
      "before": {
        "home": "chrome-2",
        "work": "chrome-1",
      },
      "duplicate": {
        "id": "chrome-1",
        "listed": [
          "chrome-2",
          "chrome-1",
        ],
        "older": "4003 This browser connected again",
      },
    }
  `);
});

it('closes a socket that does not say hello, or sends a bad frame', async () => {
  const { port } = await start(200);
  const silent = await connect(port);
  const rude = await connect(port);
  rude.send('{"kind":"hello","protocol":2}');
  expect({ silent: await silent.closed, rude: await rude.closed }).toMatchInlineSnapshot(`
    {
      "rude": "4002 Bad frame: protocol Invalid input: expected 1",
      "silent": "4000 Send hello first",
    }
  `);
});

it('fails a waiting call when the browser disconnects', async () => {
  const started = await start();
  const tools = browserTools({ bridge: started, secrets: noSecretSource, uploads: { kind: 'off' } });
  const chrome = await greet(started.port, 'Chrome', ['navigate']);
  const navigating = call(tools, 'browser_navigate', { tabId: 7, to: { kind: 'url', url: 'https://example.com/' } });
  await chrome.next();
  chrome.close();
  expect(await navigating).toMatchInlineSnapshot(`
    {
      "kind": "error",
      "text": "The browser disconnected. (failed)",
    }
  `);
});

it('sends a vault secret to the page but never to the agent', async () => {
  const asked: string[] = [];
  const vault: SecretSource = {
    resolve: (request) => {
      asked.push(`${request.entryId} ${request.field} for ${request.origin}`);
      return Promise.resolve({ kind: 'value', value: 'pw-123456' });
    },
  };
  const started = await start();
  const chrome = await greet(started.port, 'Chrome', ['list-tabs', 'fill-secret']);
  const filling = call(secretTools({ bridge: started, secrets: vault }), 'browser_fill_secret', { tabId: 7, ref: 'e4', secret: { entryId: 'shop', field: 'password' } });
  await answerNext(chrome, tabs);
  const sent = await answerNext(chrome, () => ({ kind: 'error', code: 'failed', message: 'Page rejected pw-123456' }));
  const refusing = call(secretTools({ bridge: started, secrets: noSecretSource }), 'browser_fill_secret', { tabId: 7, ref: 'e4', secret: { entryId: 'shop', field: 'password' } });
  await answerNext(chrome, tabs);
  const refused = await refusing;
  expect({ asked, sent, toAgent: await filling, refused }).toMatchInlineSnapshot(`
    {
      "asked": [
        "shop password for https://shop.example",
      ],
      "refused": {
        "kind": "error",
        "text": "The Secrets Vault is not set up yet. Ask the person to fill this field (request a takeover).",
      },
      "sent": {
        "field": "password",
        "kind": "fill-secret",
        "origin": "https://shop.example",
        "ref": "e4",
        "tabId": 7,
        "value": "pw-123456",
      },
      "toAgent": {
        "kind": "error",
        "text": "Page rejected ••• (failed)",
      },
    }
  `);
});

it('waits for the person to finish a takeover, and ends it when the turn stops', async () => {
  const started = await start();
  const tools = secretTools({ bridge: started, secrets: noSecretSource });
  const chrome = await greet(started.port, 'Chrome', ['start-takeover', 'end-takeover']);
  const finished = call(tools, 'browser_request_takeover', { tabId: 7, reason: 'two-factor', message: 'Enter the code from your phone.' });
  const handed = await answerNext(chrome, done);
  if (handed.kind !== 'start-takeover') throw new Error(handed.kind);
  chrome.send({ kind: 'event', event: { kind: 'takeover-ended', tabId: 7, takeoverId: handed.takeoverId, outcome: 'done' } });
  const stop = new AbortController();
  const stopped = call(tools, 'browser_request_takeover', { tabId: 7, reason: 'captcha', message: 'Solve the check.' }, stop.signal);
  await answerNext(chrome, done);
  stop.abort();
  const ended = await answerNext(chrome, done);
  expect({ finished: await finished, stopped: await stopped, ended: ended.kind }).toMatchInlineSnapshot(`
    {
      "ended": "end-takeover",
      "finished": {
        "kind": "text",
        "text": "The person says they are done. Take a new snapshot before you carry on.",
      },
      "stopped": {
        "kind": "error",
        "text": "The takeover was stopped.",
      },
    }
  `);
});
