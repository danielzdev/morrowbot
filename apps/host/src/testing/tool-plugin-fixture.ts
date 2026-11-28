import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BROWSER_BRIDGE_SUBPROTOCOL,
  LOOPBACK_TOKEN_PREFIX,
  PluginBridgeMessage,
  type BrowserCommand,
  type BrowserCommandKind,
  type BrowserResult,
  type ExtensionMessage,
} from '@morrowbot/contracts';
import WebSocket from 'ws';

/** File URL of `@morrowbot/plugin-sdk` so temp fixture plugins outside the workspace can import it. */
export const PLUGIN_SDK_URL = pathToFileURL(fileURLToPath(new URL('../../../../packages/plugin-sdk/src/index.ts', import.meta.url))).href;

/** Allocates an ephemeral TCP port on 127.0.0.1 and releases it immediately for a test plugin. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  if (address === null || typeof address === 'string') throw new Error('Could not bind a free port');
  return address.port;
}

export interface FakeBrowserExtension {
  nextCommand(): Promise<{ readonly id: number; readonly command: BrowserCommand }>;
  reply(id: number, result: BrowserResult): void;
  close(): void;
}

/** Connects a fake Ori Bot browser extension to the real Browser plugin's loopback WebSocket bridge. */
export async function connectFakeBrowser(port: number, token: string, commands: BrowserCommandKind[]): Promise<FakeBrowserExtension> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/`, [BROWSER_BRIDGE_SUBPROTOCOL, `${LOOPBACK_TOKEN_PREFIX}${token}`], {
    headers: { origin: 'chrome-extension://test-extension' },
  });
  const inbox: PluginBridgeMessage[] = [];
  let wake: () => void = () => undefined;
  socket.on('message', (raw) => {
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8') : raw.toString('utf8');
    inbox.push(PluginBridgeMessage.parse(JSON.parse(text)));
    wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const hello: ExtensionMessage = {
    kind: 'hello',
    protocol: 1,
    browser: { family: 'chromium', name: 'Chrome', version: '140' },
    extensionVersion: '0.1.0',
    instanceId: 'chrome-test-0001',
    commands,
  };
  socket.send(JSON.stringify(hello));
  const next = async (): Promise<PluginBridgeMessage> => {
    while (inbox.length === 0) await new Promise<void>((resolve) => (wake = resolve));
    const message = inbox.shift();
    if (message === undefined) throw new Error('empty inbox');
    return message;
  };
  const welcome = await next();
  if (welcome.kind !== 'welcome') throw new Error(`expected welcome, got ${welcome.kind}`);
  return {
    nextCommand: async () => {
      for (;;) {
        const message = await next();
        if (message.kind === 'command') return { id: message.id, command: message.command };
      }
    },
    reply: (id, result) => {
      const frame: ExtensionMessage = { kind: 'result', id, result };
      socket.send(JSON.stringify(frame));
    },
    close: () => {
      socket.close();
    },
  };
}

/** Writes a minimal tool plugin folder into `dir/<id>`. */
export async function writeToolPlugin(dir: string, id: string, code: string): Promise<void> {
  const folder = path.join(dir, id);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'manifest.json'),
    JSON.stringify({ protocolVersion: 1, id, name: id, version: '1.0.0', kind: 'tool', main: 'index.ts', permissions: [], settingsSchema: {} }),
  );
  await writeFile(path.join(folder, 'index.ts'), code);
}
