import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatEvent, ProviderBinding } from '@morrowbot/contracts';
import { z } from 'zod';
import { startChatFixture, type ChatFixture } from './chat-fixture.ts';
import type { Reply, TestHostOptions } from './test-host.ts';

const FAKE_CODEX = fileURLToPath(new URL('../features/providers/fixtures/fake-codex.ts', import.meta.url));

export const CODEX: Extract<ProviderBinding, { kind: 'bound' }> = {
  kind: 'bound',
  pluginId: 'provider-openai',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'personal',
};

/** A ChatGPT Pro login in workspace `ws-1` on the built-in route, with one MCP server configured. */
export const NATIVE = {
  account: {
    account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro', workspaceName: null },
    userId: 'user-1',
    requiresOpenaiAuth: true,
    workspaceRouting: { chatgptAccountId: 'ws-1', backendOrigin: 'https://chatgpt.com', accountRoutingOverride: 'NO_CONSTRAINT' },
  },
  config: {
    model_provider: null,
    openai_base_url: null,
    chatgpt_base_url: 'https://chatgpt.com/backend-api/',
    model_providers: {},
    mcp_servers: { node_repl: { command: 'node_repl' } },
  },
  rateLimits: {
    rateLimits: { limitId: 'codex', planType: 'pro', primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1795984257 }, secondary: null },
    rateLimitsByLimitId: null,
    accountId: 'ws-1',
  },
};

const Logged = z.object({ daemon: z.number(), method: z.string(), params: z.unknown() });
export type Logged = z.infer<typeof Logged>;

export interface CodexFixture extends ChatFixture {
  readonly home: string;
  /** Every request the fake daemons got, oldest first. */
  log(): Promise<Logged[]>;
  /** Merges into the fake's `state.json` at once. */
  setState(patch: Readonly<Record<string, unknown>>): Promise<void>;
  /** Merges into `state.json` after `reads` more `account/read`s have been answered. */
  switchAfter(reads: number, patch: Readonly<Record<string, unknown>>): Promise<void>;
  /** The provider-openai daemon rows the host tracks. */
  daemonPgids(): number[];
  post(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<Reply>;
  /** The events of one generation received so far, typed. */
  turnEvents(generationId: string): ChatEvent[];
}

/**
 * A host whose built-in Codex provider runs the fake Codex, with `$HOME` a temp folder. Codex offers
 * turns only on macOS (`platformReason`), so the host acts as on macOS on every OS.
 */
export async function startCodexFixture(options: Partial<TestHostOptions> = {}): Promise<CodexFixture> {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-codex-')));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const dir = path.join(home, 'fake-codex');
  await mkdir(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify(NATIVE));
  const chat = await startChatFixture({ platform: 'darwin', ...options, dataDir: path.join(home, 'data') });
  const configured = await chat.host.call('PUT', '/api/plugins/provider-openai/config', { config: { cliPath: FAKE_CODEX } });
  if (configured.status !== 200) throw new Error(`config refused: ${JSON.stringify(configured.body)}`);
  const readState = async (): Promise<Record<string, unknown>> => z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(stateFile, 'utf8')));
  return {
    ...chat,
    home,
    agent: (binding = CODEX) => chat.agent(binding),
    log: async () => {
      const text = await readFile(path.join(dir, 'log.jsonl'), 'utf8').catch(() => '');
      return text.split('\n').filter((line) => line !== '').map((line) => Logged.parse(JSON.parse(line)));
    },
    setState: async (patch) => {
      await writeFile(stateFile, JSON.stringify({ ...(await readState()), ...patch }));
    },
    switchAfter: async (reads, patch) => {
      await writeFile(path.join(dir, 'switch.json'), JSON.stringify({ afterReads: reads, state: patch }));
    },
    daemonPgids: () => chat.host.host.plugins.groups.daemons('provider-openai').map((row) => row.pgid),
    turnEvents: (generationId) => chat.events.received.filter((event) => event.kind !== 'usage.updated' && event.generationId === generationId),
    post: (thread, text, sessionChoice = { kind: 'auto' }) => chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice }),
    close: async () => {
      await chat.close();
      process.env.HOME = previousHome;
      await rm(home, { recursive: true, force: true });
    },
  };
}

/** The methods the fake got, without the handshake and the read-only account and config reads. */
export function turnMethods(log: readonly Logged[]): string[] {
  const quiet = new Set(['initialize', 'initialized', 'account/read', 'config/read', 'model/list', 'mcpServerStatus/list', 'hooks/list', 'thread/loaded/list', 'configRequirements/read']);
  return log.filter((entry) => !quiet.has(entry.method)).map((entry) => entry.method);
}
