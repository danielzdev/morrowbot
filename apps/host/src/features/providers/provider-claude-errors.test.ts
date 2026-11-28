import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  Agent,
  MessageList,
  StartedSend,
  StopGenerationResponse,
  Thread,
  type ProviderBinding,
} from '@morrowbot/contracts';
import { z } from 'zod';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startHost } from '../../host.ts';
import { DEFAULT_PLUGIN_TIMEOUTS, sequence, startTestHost, type EventClient, type PluginTimeouts, type TestHost } from '../../testing/test-host.ts';


const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.ts', import.meta.url));
const READ_ONLY: ProviderBinding = {
  kind: 'bound',
  pluginId: 'provider-claude',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'isolated',
};

let home = '';
let host: TestHost | undefined;
let events: EventClient;

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-claude-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  vi.stubEnv('USER', 'tester');
});

afterEach(async () => {
  await host?.close();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
  expect(host?.errors ?? []).toEqual([]);
  host = undefined;
});

/** A host with the real provider-claude plugin running `cliPath` (the fake CLI unless given). */
async function boot(cliPath = FAKE_CLAUDE, timeouts?: PluginTimeouts): Promise<TestHost> {
  const started = await startTestHost({ dataDir: path.join(home, 'data'), ...(timeouts === undefined ? {} : { timeouts }) });
  host = started;
  events = await started.events();
  expect((await started.call('PUT', '/api/plugins/provider-claude/config', { config: { cliPath } })).status).toBe(200);
  return started;
}

/** A `claude` in the temp home that runs the fake, so a test can delete it or change its mtime. */
async function wrapper(): Promise<string> {
  const file = path.join(home, 'bin', 'claude');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\nexec "${FAKE_CLAUDE}" "$@"\n`);
  await chmod(file, 0o755);
  return file;
}

async function thread(on: TestHost): Promise<Thread> {
  const agent = Agent.parse((await on.call('POST', '/api/agents', { name: 'Helper', provider: READ_ONLY })).body);
  const created = Thread.parse((await on.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Chat' })).body);
  await events.watch(created.id);
  return created;
}

async function start(on: TestHost, to: Thread, text: string): Promise<string> {
  const reply = await on.call('POST', `/api/threads/${to.id}/messages`, { text, sessionChoice: { kind: 'auto' } });
  return StartedSend.parse(reply.body).generationId;
}

async function send(on: TestHost, to: Thread, text: string): Promise<void> {
  await events.finished(await start(on, to, text));
}

async function stop(on: TestHost, of: Thread) {
  return StopGenerationResponse.parse((await on.call('POST', `/api/threads/${of.id}/stop`)).body);
}

async function history(on: TestHost, of: Thread): Promise<string[]> {
  const { messages } = MessageList.parse((await on.call('GET', `/api/threads/${of.id}/messages`)).body);
  return messages.map((message) => {
    if (message.kind === 'user') return `user: ${message.text}`;
    const { outcome } = message;
    const label = outcome.kind !== 'failed' ? outcome.kind : `failed ${JSON.stringify(outcome.error)}`;
    return `assistant(${label}): ${message.text.replace(/\d+/g, 'N')}`.replaceAll(home, '$HOME');
  });
}

const Invocation = z.object({ args: z.array(z.string()), pid: z.number() });

async function invocations(): Promise<z.infer<typeof Invocation>[]> {
  const text = await readFile(path.join(home, 'fake-claude', 'log.jsonl'), 'utf8').catch(() => '');
  return text.split('\n').filter((line) => line !== '').map((line) => Invocation.parse(JSON.parse(line)));
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let waitedMs = 0; !(await check()); waitedMs += 20) {
    if (waitedMs > 10_000) throw new Error('timed out waiting');
    await sleep(20);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The pids still alive after up to 5 s. */
async function stillAlive(pids: Record<string, number>): Promise<string[]> {
  for (let waitedMs = 0; waitedMs < 5_000 && Object.values(pids).some(isAlive); waitedMs += 50) await sleep(50);
  return Object.entries(pids).flatMap(([name, pid]) => (isAlive(pid) ? [name] : []));
}

it('fails a signed-out reply, a CLI that exits with an error, and a CLI that has gone missing, each with its reason', async () => {
  const on = await boot(await wrapper());
  const chat = await thread(on);
  await send(on, chat, 'fail');
  await send(on, chat, 'crash');
  await rm(path.join(home, 'bin', 'claude'));
  await send(on, chat, 'hello');
  const info = (await on.call('GET', '/api/plugins/provider-claude/info?refresh=1')).body;
  expect({ history: await history(on, chat), info }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: fail",
        "assistant(failed {"kind":"signed-out"}): ",
        "user: crash",
        "assistant(failed {"kind":"other","message":"Claude Code exited with code 2 before it replied: fake claude: boom"}): ",
        "user: hello",
        "assistant(failed {"kind":"not-installed"}): ",
      ],
      "info": {
        "info": {
          "install": "Install Claude Code (https://docs.claude.com/claude-code), or set "Claude Code CLI path".",
          "kind": "missing-runtime",
        },
      },
    }
  `);
});

it('stops a stalled CLI and the tool it started even though both ignore SIGTERM, then answers the next message', async () => {
  const on = await boot();
  const chat = await thread(on);
  const generationId = await start(on, chat, 'stall');
  let pids: Record<string, number> = {};
  await events.until((event) => {
    const match = event.kind === 'generation.delta' && event.generationId === generationId ? /pids (\d+) (\d+)/.exec(event.text) : null;
    if (match !== null) pids = { cli: Number(match[1]), tool: Number(match[2]) };
    return match !== null;
  });
  const stopped = await stop(on, chat);
  const aliveLater = await stillAlive(pids);
  await send(on, chat, 'hello');
  expect({ stopped: stopped.kind, aliveLater, history: await history(on, chat) }).toMatchInlineSnapshot(`
    {
      "aliveLater": [],
      "history": [
        "user: stall",
        "assistant(cancelled): pids N N",
        "user: hello",
        "assistant(completed): Hello",
      ],
      "stopped": "stopped",
    }
  `);
});

it('kills a worker whose stopped turn is stuck in a hung --version check after turnStopMs, then restarts it for the next message', async () => {
  const cli = await wrapper();
  const on = await boot(cli, { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 300 });
  expect((await on.call('GET', '/api/plugins/provider-claude/info')).status).toBe(200);
  await mkdir(path.join(home, 'fake-claude'), { recursive: true });
  await writeFile(path.join(home, 'fake-claude', 'hang-version'), '');
  const later = new Date(Date.now() + 60_000);
  await utimes(cli, later, later);
  const chat = await thread(on);
  await start(on, chat, 'hello');
  await waitFor(async () => (await invocations()).filter(({ args }) => args[0] === '--version').length === 2);
  const hung = (await invocations()).at(-1)?.pid ?? 0;
  await rm(path.join(home, 'fake-claude', 'hang-version'));
  const stopped = await stop(on, chat);
  const aliveLater = await stillAlive({ hung });
  await waitFor(async () => (await on.call('GET', '/api/plugins/provider-claude/info')).status === 200);
  await send(on, chat, 'hello');
  expect({ stopped: stopped.kind, aliveLater, history: await history(on, chat) }).toMatchInlineSnapshot(`
    {
      "aliveLater": [],
      "history": [
        "user: hello",
        "assistant(interrupted): ",
        "user: hello",
        "assistant(completed): Hello",
      ],
      "stopped": "stopped",
    }
  `);
});

it('does not start the provider when it is disabled, and keeps it off in safe mode by its own switch', async () => {
  const on = await boot();
  const chat = await thread(on);
  await on.call('PUT', '/api/plugins/provider-claude/enabled', { enabled: false });
  const refused = await on.call('POST', `/api/threads/${chat.id}/messages`, { text: 'hello', sessionChoice: { kind: 'auto' } });
  const status = (id: string, list: readonly { manifest: { id: string }; status: unknown }[]) => list.find(({ manifest }) => manifest.id === id)?.status;
  const disabled = status('provider-claude', on.host.plugins.list());
  await on.close();
  host = undefined;
  const safeErrors: unknown[] = [];
  const safe = await startHost({
    config: { hostname: '127.0.0.1', port: 0, safeMode: true, dataDir: path.join(home, 'data'), pluginsDir: path.join(home, 'data', 'plugins'), builtinPluginsDir: null },
    version: '0.0.0-test',
    onPluginStatus: () => undefined,
    ...sequence(),
    report: (error) => safeErrors.push(error),
    pluginPath: process.env.PATH ?? '/usr/bin:/bin',
  });
  const safeMode = status('provider-claude', safe.plugins.list());
  await safe.close();
  expect({ disabled, refused, safeMode, safeErrors, invocations: await invocations() }).toMatchInlineSnapshot(`
    {
      "disabled": {
        "kind": "disabled",
      },
      "invocations": [],
      "refused": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Provider plugin provider-claude is not available: Plugin "provider-claude" is not running (disabled)",
          },
        },
        "status": 409,
      },
      "safeErrors": [],
      "safeMode": {
        "kind": "disabled",
      },
    }
  `);
});
