import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, PluginConfig, StreamChunk } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createJsonPluginStore, startPluginHost, type PluginHost } from './index.ts';

const PLUGINS = fileURLToPath(new URL('../../../../../plugins', import.meta.url));
const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.ts', import.meta.url));

let home = '';
const hosts: PluginHost[] = [];

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-claude-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USER', 'tester');
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  vi.stubEnv('MORROWBOT_TEST_SECRET', 'must not reach the plugin');
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

async function boot(config: PluginConfig = { cliPath: FAKE_CLAUDE }, options = { safeMode: false, enabled: true }) {
  const store = createJsonPluginStore(path.join(home, 'plugins.json'));
  await store.write('provider-claude', { enabled: options.enabled, config });
  const host = await startPluginHost({
    pluginsDir: PLUGINS,
    store,
    safeMode: options.safeMode,
    dataDir: path.join(home, 'plugin-data'),
  });
  hosts.push(host);
  return host;
}

async function ask(
  host: PluginHost,
  content: string | ChatMessage[],
  signal?: AbortSignal,
  onChunk?: (chunk: StreamChunk) => void,
) {
  const chunks: StreamChunk[] = [];
  const messages: ChatMessage[] = typeof content === 'string' ? [{ role: 'user', content }] : content;
  const finish = await host
    .stream(
      'provider-claude',
      { messages },
      (chunk) => {
        chunks.push(chunk);
        onChunk?.(chunk);
      },
      signal,
    )
    .catch((error: unknown) => String(error));
  return { chunks, finish };
}

const status = (host: PluginHost) => host.list().find(({ manifest }) => manifest.id === 'provider-claude')?.status;

it('streams text, status, tool events, and the final reply through the plugin host', async () => {
  const host = await boot({ cliPath: FAKE_CLAUDE, model: 'haiku' });
  expect(await ask(host, 'hello')).toMatchInlineSnapshot(`
    {
      "chunks": [
        {
          "kind": "status",
          "text": "Started haiku",
        },
        {
          "kind": "status",
          "text": "Thinking",
        },
        {
          "input": {
            "file_path": "./note.txt",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "toolu_1",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "toolu_1",
        },
        {
          "kind": "text",
          "text": "Hel",
        },
        {
          "kind": "text",
          "text": "lo",
        },
        {
          "kind": "final",
          "text": "Hello",
        },
      ],
      "finish": "stop",
    }
  `);
});

it('runs the CLI in the plugin data folder with only the declared environment and a private system prompt', async () => {
  const host = await boot();
  const { chunks } = await ask(host, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'env' },
  ]);
  const text = chunks.flatMap((chunk) => (chunk.kind === 'text' ? [chunk.text] : [])).join('');
  expect(text.replace(home, '$HOME')).toMatchInlineSnapshot(`
    "cwd=$HOME/plugin-data/provider-claude
    env=CLAUDE_CONFIG_DIR,HOME,PATH,USER
    args=--print --output-format stream-json --verbose --include-partial-messages --no-session-persistence --append-system-prompt-file /dev/fd/4
    system=Be brief."
  `);
});

/** Starts a stalled reply and resolves with the CLI's pid, its stuck tool's pid, and the plugin's pid. */
async function stallReply(host: PluginHost, mode: 'stall' | 'stall-polite', controller = new AbortController()) {
  const pids = Promise.withResolvers<{ cli: number; tool: number; plugin: number }>();
  const reply = ask(host, mode, controller.signal, (chunk) => {
    const match = chunk.kind === 'text' ? /pids (\d+) (\d+) guard (\d+)/.exec(chunk.text) : null;
    if (match === null) return;
    const plugin = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(match[3])], { encoding: 'utf8' }).trim());
    pids.resolve({ cli: Number(match[1]), tool: Number(match[2]), plugin });
  });
  return { pids: await pids.promise, reply };
}

async function stillAlive(pids: Record<string, number>): Promise<string[]> {
  for (let waitedMs = 0; waitedMs < 5_000 && Object.values(pids).some(isAlive); waitedMs += 50) await sleep(50);
  return Object.entries(pids).flatMap(([name, pid]) => (isAlive(pid) ? [name] : []));
}

it('stops the CLI and anything it started when the stream is cancelled, even if they ignore SIGTERM', async () => {
  const host = await boot();
  const controller = new AbortController();
  const { pids, reply } = await stallReply(host, 'stall', controller);
  controller.abort();
  expect({
    finish: (await reply).finish,
    aliveLater: await stillAlive({ cli: pids.cli, tool: pids.tool }),
    next: (await ask(host, 'hello')).finish,
  }).toMatchInlineSnapshot(`
    {
      "aliveLater": [],
      "finish": "cancelled",
      "next": "stop",
    }
  `);
});

it('stops a running CLI and its leftovers when the host stops', async () => {
  const host = await boot();
  const { pids, reply } = await stallReply(host, 'stall-polite');
  await host.stop();
  expect({ reply: (await reply).finish, aliveLater: await stillAlive(pids) }).toMatchInlineSnapshot(`
    {
      "aliveLater": [],
      "reply": "cancelled",
    }
  `);
});

it('stops a running CLI when the plugin process is killed outright', async () => {
  const host = await boot();
  const { pids, reply } = await stallReply(host, 'stall');
  process.kill(pids.plugin, 'SIGKILL');
  expect({ reply: (await reply).finish, aliveLater: await stillAlive(pids), status: status(host)?.kind })
    .toMatchInlineSnapshot(`
      {
        "aliveLater": [],
        "reply": "PluginGoneError: The plugin process stopped before it answered",
        "status": "crashed",
      }
    `);
});

it('reports CLI errors, crashes, a missing CLI, and a signed-out CLI clearly', async () => {
  const host = await boot();
  const failed = await ask(host, 'fail');
  const crashed = await ask(host, 'crash');
  const healthy = await host.checkHealth('provider-claude');
  vi.stubEnv('CLAUDE_CONFIG_DIR', '/signed-out');
  await host.setConfig('provider-claude', { cliPath: FAKE_CLAUDE });
  const signedOut = await host.checkHealth('provider-claude');
  await host.setConfig('provider-claude', { cliPath: path.join(home, 'no-such-claude') });
  const missing = await host.checkHealth('provider-claude');
  const missingStream = await ask(host, 'hello');
  expect({
    failed: failed.finish,
    crashed: crashed.finish,
    healthy,
    signedOut,
    missing: JSON.stringify(missing).replace(home, '$HOME'),
    missingStream: missingStream.finish.replace(home, '$HOME'),
  }).toMatchInlineSnapshot(`
    {
      "crashed": "PluginRequestError: Claude Code exited with code 2 before it replied: fake claude: boom",
      "failed": "PluginRequestError: Claude Code: Not logged in · Please run /login",
      "healthy": {
        "kind": "running",
      },
      "missing": "{"kind":"unhealthy","detail":"Claude Code CLI not found (\\"$HOME/no-such-claude\\"). Install Claude Code, or set \\"Claude Code CLI path\\" in this plugin's settings."}",
      "missingStream": "PluginRequestError: Claude Code CLI not found ("$HOME/no-such-claude"). Install Claude Code, or set "Claude Code CLI path" in this plugin's settings.",
      "signedOut": {
        "detail": "Claude Code is signed out. Run "claude auth login" in a terminal, then check again.",
        "kind": "unhealthy",
      },
    }
  `);
});

it('boots without starting the plugin in safe mode or when it is disabled', async () => {
  const safe = await boot(undefined, { safeMode: true, enabled: true });
  const disabled = await boot(undefined, { safeMode: false, enabled: false });
  expect({ safeMode: status(safe), disabled: status(disabled), refused: (await ask(disabled, 'hello')).finish })
    .toMatchInlineSnapshot(`
      {
        "disabled": {
          "kind": "disabled",
        },
        "refused": "Error: Plugin "provider-claude" is not running (disabled)",
        "safeMode": {
          "kind": "safe-mode",
        },
      }
    `);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
