import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCopyText, parseSubscription, proxyRequest, type HostTarget, type IpcSender } from './ipc-proxy.ts';

const RENDERER_URL = 'file:///Applications/MorrowBot.app/Contents/Resources/app/src/renderer/index.html';
const TOKEN = 'a'.repeat(43);
const APP_PAGE: IpcSender = { kind: 'frame', url: RENDERER_URL, isMainFrame: true };

interface Seen {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let server: Server;
let host: HostTarget;
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      response
        .writeHead(200, { 'content-type': 'application/json', 'x-echo-authorization': request.headers.authorization ?? '' })
        .end(JSON.stringify({ agents: [] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('fake host is not on TCP');
  host = { url: `http://127.0.0.1:${String(address.port)}`, token: TOKEN };
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Runs one proxied request and records the outcome without the secret token. */
async function outcome(sender: IpcSender, input: unknown): Promise<unknown> {
  seen.length = 0;
  try {
    const reply = await proxyRequest({ sender, rendererUrl: RENDERER_URL, input, host });
    const request = seen[0];
    return {
      reply,
      replyHasToken: JSON.stringify(reply).includes(TOKEN),
      hostSaw: request && {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization?.replace(TOKEN, '<token>'),
        origin: request.headers.origin,
        contentType: request.headers['content-type'],
        body: request.body,
      },
    };
  } catch (error) {
    return { refused: error instanceof Error ? error.message : error, hostCalls: seen.length };
  }
}

it('an IPC message from a wrong sender is refused', async () => {
  const request = { method: 'GET', path: '/api/agents' };
  expect({
    wrongUrl: await outcome({ kind: 'frame', url: 'https://evil.example/index.html', isMainFrame: true }, request),
    iframe: await outcome({ kind: 'frame', url: RENDERER_URL, isMainFrame: false }, request),
    missingFrame: await outcome({ kind: 'missing-frame' }, request),
    appPage: await outcome(APP_PAGE, { method: 'POST', path: '/api/agents?x=1', body: { name: 'Ada' } }),
  }).toMatchInlineSnapshot(`
    {
      "appPage": {
        "hostSaw": {
          "authorization": "Bearer <token>",
          "body": "{"name":"Ada"}",
          "contentType": "application/json",
          "method": "POST",
          "origin": undefined,
          "url": "/api/agents?x=1",
        },
        "reply": {
          "body": {
            "agents": [],
          },
          "status": 200,
        },
        "replyHasToken": false,
      },
      "iframe": {
        "hostCalls": 0,
        "refused": "IPC sender is not the main frame of the app window",
      },
      "missingFrame": {
        "hostCalls": 0,
        "refused": "IPC sender has no frame",
      },
      "wrongUrl": {
        "hostCalls": 0,
        "refused": "IPC sender is not the app page: https://evil.example/index.html",
      },
    }
  `);
});

it('renderer never sees the token', async () => {
  expect({
    proxied: await outcome(APP_PAGE, { method: 'GET', path: '/api/agents' }),
    health: await outcome(APP_PAGE, { method: 'GET', path: '/health' }),
    dotDot: await outcome(APP_PAGE, { method: 'GET', path: '/api/../health' }),
    encodedDotDot: await outcome(APP_PAGE, { method: 'GET', path: '/api/%2e%2e/health' }),
    otherHost: await outcome(APP_PAGE, { method: 'GET', path: '//evil.example/api/agents' }),
    absolute: await outcome(APP_PAGE, { method: 'GET', path: 'http://evil.example/api/agents' }),
    prefixOnly: await outcome(APP_PAGE, { method: 'GET', path: '/apix' }),
    extraField: await outcome(APP_PAGE, { method: 'GET', path: '/api/agents', token: 'x' }),
  }).toMatchInlineSnapshot(`
    {
      "absolute": {
        "hostCalls": 0,
        "refused": "Only /api/ paths are proxied",
      },
      "dotDot": {
        "hostCalls": 0,
        "refused": "Only /api/ paths are proxied",
      },
      "encodedDotDot": {
        "hostCalls": 0,
        "refused": "Only /api/ paths are proxied",
      },
      "extraField": {
        "hostCalls": 0,
        "refused": "Malformed API request",
      },
      "health": {
        "hostCalls": 0,
        "refused": "Only /api/ paths are proxied",
      },
      "otherHost": {
        "hostCalls": 0,
        "refused": "Only /api/ paths are proxied",
      },
      "prefixOnly": {
        "hostCalls": 0,
        "refused": "Only /api/ paths are proxied",
      },
      "proxied": {
        "hostSaw": {
          "authorization": "Bearer <token>",
          "body": "",
          "contentType": undefined,
          "method": "GET",
          "origin": undefined,
          "url": "/api/agents",
        },
        "reply": {
          "body": {
            "agents": [],
          },
          "status": 200,
        },
        "replyHasToken": false,
      },
    }
  `);
});

it('a thread subscription from a wrong sender or with a bad frame is refused', () => {
  const subscribe = { kind: 'subscribe', threadId: 'thread-1', since: { hostEpoch: 'epoch', seq: 3 } };
  const attempt = (sender: IpcSender, input: unknown): unknown => {
    try {
      return parseSubscription({ sender, rendererUrl: RENDERER_URL, input });
    } catch (error) {
      return { refused: error instanceof Error ? error.message : error };
    }
  };
  expect({
    iframe: attempt({ kind: 'frame', url: RENDERER_URL, isMainFrame: false }, subscribe),
    malformed: attempt(APP_PAGE, { kind: 'subscribe', threadId: 'thread-1' }),
    appPage: attempt(APP_PAGE, subscribe),
  }).toMatchInlineSnapshot(`
    {
      "appPage": {
        "kind": "subscribe",
        "since": {
          "hostEpoch": "epoch",
          "seq": 3,
        },
        "threadId": "thread-1",
      },
      "iframe": {
        "refused": "IPC sender is not the main frame of the app window",
      },
      "malformed": {
        "refused": "Malformed subscription",
      },
    }
  `);
});

it('only the app page may write plain text to the clipboard', () => {
  const attempt = (sender: IpcSender, input: unknown): unknown => {
    try {
      return parseCopyText({ sender, rendererUrl: RENDERER_URL, input });
    } catch (error) {
      return { refused: error instanceof Error ? error.message : error };
    }
  };
  expect({
    wrongUrl: attempt({ kind: 'frame', url: 'https://evil.example/index.html', isMainFrame: true }, 'claude auth login'),
    notText: attempt(APP_PAGE, { text: 'claude auth login' }),
    appPage: attempt(APP_PAGE, 'claude auth login'),
  }).toMatchInlineSnapshot(`
    {
      "appPage": "claude auth login",
      "notText": {
        "refused": "Malformed clipboard text",
      },
      "wrongUrl": {
        "refused": "IPC sender is not the app page: https://evil.example/index.html",
      },
    }
  `);
});
