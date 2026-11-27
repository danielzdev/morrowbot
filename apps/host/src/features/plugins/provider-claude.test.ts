import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { PluginConfig, StreamChunk } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createJsonPluginStore, startPluginHost, type PluginHost } from './index.ts';

const PLUGINS = fileURLToPath(new URL('../../../../../plugins', import.meta.url));
const FAKE_CLAUDE = path.join(PLUGINS, 'provider-claude/test/fake-claude.ts');

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
  const host = await startPluginHost({ pluginsDir: PLUGINS, store, safeMode: options.safeMode });
  hosts.push(host);
  return host;
}

async function ask(host: PluginHost, content: string, signal?: AbortSignal, onChunk?: (chunk: StreamChunk) => void) {
  const chunks: StreamChunk[] = [];
  const finish = await host
    .stream(
      'provider-claude',
      { messages: [{ role: 'user', content }] },
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

it('runs the CLI in the home folder with only the declared environment and the structured-output flags', async () => {
  const host = await boot();
  const { chunks } = await ask(host, 'env');
  const text = chunks.flatMap((chunk) => (chunk.kind === 'text' ? [chunk.text.replace(home, '$HOME').replace(',__CF_USER_TEXT_ENCODING', '')] : []));
  expect(text.join('')).toMatchInlineSnapshot(
    `"cwd=$HOME env=CLAUDE_CONFIG_DIR,HOME,PATH,USER args=--print --output-format stream-json --verbose --include-partial-messages --no-session-persistence"`,
  );
});

it('stops the CLI process when the stream is cancelled, even if it ignores SIGTERM', async () => {
  const host = await boot();
  const controller = new AbortController();
  let pid = 0;
  const cancelled = await ask(host, 'stall', controller.signal, (chunk) => {
    if (chunk.kind !== 'text') return;
    pid = Number(/pid (\d+)/.exec(chunk.text)?.[1]);
    controller.abort();
  });
  const aliveAfterCancel = isAlive(pid);
  let waitedMs = 0;
  while (isAlive(pid) && waitedMs < 5_000) {
    await sleep(50);
    waitedMs += 50;
  }
  expect({
    finish: cancelled.finish,
    aliveAfterCancel,
    aliveLater: isAlive(pid),
    next: (await ask(host, 'hello')).finish,
  }).toMatchInlineSnapshot(`
    {
      "aliveAfterCancel": true,
      "aliveLater": false,
      "finish": "cancelled",
      "next": "stop",
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
