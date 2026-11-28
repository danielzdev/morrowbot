import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HostTools, TurnChunk, TurnRequest } from '@morrowbot/contracts';
import { standaloneRuntime, type ProviderPlugin } from '@morrowbot/plugin-sdk';
import { BUILTIN_PROVIDERS } from '@morrowbot/providers';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FAKE_AGY } from '../../testing/agy-fixture.ts';

let home: string;
let provider: ProviderPlugin;

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'oribot-agy-')));
  const adapter = BUILTIN_PROVIDERS.find((entry) => entry.manifest.id === 'provider-antigravity');
  if (adapter === undefined) throw new Error('provider-antigravity is not built in');
  provider = adapter.create(standaloneRuntime({ env: { ...process.env, HOME: home }, platform: 'darwin' }));
  await mkdir(path.join(home, 'data'), { recursive: true });
  await provider.init?.({ config: { cliPath: FAKE_AGY }, dataDir: path.join(home, 'data') });
  await provider.providerInfo({ refresh: true });
});

afterEach(async () => {
  await provider.shutdown?.();
  await rm(home, { recursive: true, force: true });
});

function request(session: TurnRequest['session'], prompt: string, hostTools: HostTools = { kind: 'none' }): TurnRequest {
  return {
    turnId: 'turn-1',
    cwd: home,
    mode: 'interactive',
    access: 'read-only',
    vendorSettings: 'personal',
    expectedAccountKey: '',
    expectedRouteKey: '',
    selection: { kind: 'default' },
    session,
    system: '',
    prompt,
    images: [],
    hostTools,
  };
}

async function turn(session: TurnRequest['session'], prompt: string, hostTools?: HostTools): Promise<{ outcome: unknown; chunks: TurnChunk[] }> {
  const chunks: TurnChunk[] = [];
  const end = await provider.turn({
    request: request(session, prompt, hostTools),
    signal: new AbortController().signal,
    emit: (chunk) => {
      chunks.push(chunk);
    },
    ask: () => Promise.reject(new Error('no approvals in this test')),
    onSteer: () => undefined,
  });
  return { outcome: end.outcome, chunks: chunks.filter((chunk) => chunk.kind !== 'model-options-changed') };
}

it('resumes a session through session/load without replaying its history into the turn', async () => {
  expect(await turn({ kind: 'resume', ref: 'sess-old' }, 'hello')).toMatchInlineSnapshot(`
    {
      "chunks": [
        {
          "kind": "text",
          "text": "Echo: ",
        },
        {
          "kind": "text",
          "text": "hello",
        },
      ],
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
    }
  `);
});

/** A stand-in for the host's MCP endpoint: `tools/call` answers with the name of the token it came with. */
async function startTools(tokens: Readonly<Record<string, string>>): Promise<{ readonly url: string; readonly server: Server }> {
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const message: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const id = typeof message === 'object' && message !== null && 'id' in message ? message.id : undefined;
      const named = Object.entries(tokens).find(([, token]) => incoming.headers.authorization === `Bearer ${token}`)?.[0];
      if (named === undefined) response.writeHead(401).end();
      else if (id === undefined) response.writeHead(202).end();
      else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `called with ${named}` }] } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${String(address.port)}/mcp`, server };
}

it("a reloaded session calls Ori Bot's tools with its own turn's token, and no earlier turn's bridge is left running", async () => {
  const tokens = { 'first turn': 'a'.repeat(40), 'second turn': 'b'.repeat(40) };
  const tools = await startTools(tokens);
  try {
    const session = { kind: 'resume', ref: 'sess-kept' } as const;
    const texts = async (prompt: string, hostTools: HostTools): Promise<string> =>
      (await turn(session, prompt, hostTools)).chunks.flatMap((chunk) => (chunk.kind === 'text' ? [chunk.text] : [])).join('');
    expect({
      first: await texts('host-tool', { kind: 'mcp', url: tools.url, token: tokens['first turn'] }),
      second: await texts('host-tool', { kind: 'mcp', url: tools.url, token: tokens['second turn'] }),
      afterwards: await texts('servers', { kind: 'none' }),
    }).toMatchInlineSnapshot(`
      {
        "afterwards": "servers running: 0",
        "first": "host tool: called with first turn",
        "second": "host tool: called with second turn",
      }
    `);
  } finally {
    await new Promise((resolve) => tools.server.close(resolve));
  }
});
