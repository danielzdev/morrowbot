import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_TOOLS_SERVER, type HostTools } from '@morrowbot/contracts';
import { BRIDGE_KEY, BRIDGE_SOCKET, MAX_KEY_LINE } from './bridge-protocol.ts';

const BRIDGE_PATH = fileURLToPath(new URL('./bridge-process.ts', import.meta.url));

/** An ACP stdio `McpServer` for `session/new` and `session/load`: a program the agent starts and talks MCP to over stdio. */
export interface AcpStdioServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
}

/** Ori Bot's tools for one turn, for an agent that runs MCP servers only over stdio. */
export interface HostToolsBridge {
  /** The servers the turn's session opens with: Ori Bot's own, or none. */
  readonly servers: readonly AcpStdioServer[];
  /** Ends the bridge: the program it gave the agent exits, and a copy the agent starts later exits at once. */
  close(): Promise<void>;
}

const NONE: HostToolsBridge = { servers: [], close: () => Promise.resolve() };

/**
 * Bridges the host's MCP server (`tools`) to an agent over stdio, for one turn. The agent starts
 * `servers[0]` with this Node (`--disable-sigusr1`, no `PATH` lookup); that program trades the
 * one-time key in its env for the turn's token over a socket in a private folder, then relays each
 * MCP message to the host. Its env never holds the token, because an agent may save it with the
 * session (agy 1.5.18 does); the key is spent once the program has the token. The program exits
 * when `close` ends the socket, when its stdin closes (the agent ended), or when the host refuses
 * the token (the turn ended).
 */
export async function openHostToolsBridge(tools: HostTools): Promise<HostToolsBridge> {
  switch (tools.kind) {
    case 'none':
      return NONE;
    case 'mcp':
      return openBridge(tools);
  }
}

async function openBridge(tools: Extract<HostTools, { kind: 'mcp' }>): Promise<HostToolsBridge> {
  const dir = await mkdtemp(path.join(tmpdir(), 'oribot-mcp-'));
  const socketPath = path.join(dir, 'bridge.sock');
  const key = randomBytes(32).toString('base64url');
  const sockets = new Set<Socket>();
  let spent = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.setEncoding('utf8');
    let heard = '';
    const onData = (chunk: string): void => {
      heard += chunk;
      const end = heard.indexOf('\n');
      if (end === -1) {
        if (heard.length > MAX_KEY_LINE) socket.destroy();
        return;
      }
      socket.off('data', onData);
      if (spent || !sameKey(heard.slice(0, end), key)) {
        socket.destroy();
        return;
      }
      spent = true;
      socket.write(`${JSON.stringify(tools)}\n`);
    };
    socket.on('data', onData);
  });
  server.on('error', () => undefined);
  try {
    await listen(server, socketPath);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  const electron = process.versions.electron === undefined ? [] : [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }];
  return {
    servers: [
      {
        name: HOST_TOOLS_SERVER,
        command: process.execPath,
        args: ['--disable-sigusr1', BRIDGE_PATH],
        env: [{ name: BRIDGE_SOCKET, value: socketPath }, { name: BRIDGE_KEY, value: key }, ...electron],
      },
    ],
    close: async () => {
      spent = true;
      const closed = new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      for (const socket of sockets) socket.destroy();
      await closed;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function sameKey(heard: string, key: string): boolean {
  const a = Buffer.from(heard);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
