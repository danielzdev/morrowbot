import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Agent, MemoryList, MessageList, StartedSend, Thread, UsageResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CODEX } from '../../testing/codex-fixture.ts';
import { CODEX_PATH } from '../../testing/codex-live.ts';
import { startTestHost, type EventClient, type TestHost } from '../../testing/test-host.ts';

/**
 * The §5 provider-openai fixtures, run through the host and the bundled plugin on the real Codex
 * you are signed in to with ChatGPT (0.171.x; `ORIKAMI_CODEX_PATH` or `codex` on PATH). They spend
 * a little of your plan, so they run only with `ORIKAMI_LIVE_CODEX=1`.
 */
const LIVE = process.env.ORIKAMI_LIVE_CODEX === '1';
const TURN_MS = 180_000;

let root = '';
let host: TestHost;
let events: EventClient;

/** A `codex` that runs the real one with extra `-c` overrides, to move the route without touching `~/.codex`. */
async function codexWith(name: string, overrides: readonly string[]): Promise<string> {
  const real = spawnSync('/bin/sh', ['-c', `command -v "${CODEX_PATH}"`], { encoding: 'utf8' }).stdout.trim();
  const file = path.join(root, `${name}.sh`);
  await writeFile(file, `#!/bin/sh\nexec '${real}' ${overrides.map((each) => `-c '${each}'`).join(' ')} "$@"\n`);
  await chmod(file, 0o755);
  return file;
}

async function boot(cliPath: string): Promise<void> {
  host = await startTestHost({ dataDir: path.join(root, 'data') });
  events = await host.events();
  const configured = await host.call('PUT', '/api/plugins/provider-openai/config', { config: { cliPath } });
  if (configured.status !== 200) throw new Error(JSON.stringify(configured.body));
}

beforeEach(async () => {
  if (!LIVE) return;
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-live-codex-')));
});

afterEach(async () => {
  if (!LIVE) return;
  await host.close();
  await rm(root, { recursive: true, force: true });
});

async function agentThread(): Promise<{ readonly thread: Thread; readonly workspace: string }> {
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Live', provider: CODEX })).body);
  const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Live' })).body);
  await events.watch(thread.id);
  const workspace = path.join(root, 'data', 'workspaces', agent.id);
  await mkdir(path.join(workspace, '.git'), { recursive: true });
  return { thread, workspace };
}

async function send(thread: Thread, text: string): Promise<string> {
  const reply = await host.call('POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice: { kind: 'auto' } });
  const { generationId } = StartedSend.parse(reply.body);
  await events.finished(generationId);
  return generationId;
}

async function replies(of: Thread): Promise<{ readonly outcome: string; readonly text: string }[]> {
  const { messages } = MessageList.parse((await host.call('GET', `/api/threads/${of.id}/messages`)).body);
  return messages.flatMap((message) => (message.kind === 'assistant' ? [{ outcome: message.outcome.kind, text: message.text }] : []));
}

const Tokens = z.object({ input_tokens: z.number().nullable(), cached_input_tokens: z.number().nullable() });

function promptTokens(generationId: string): number {
  const db = new DatabaseSync(path.join(root, 'data', 'orikami.sqlite'), { readOnly: true });
  const row = Tokens.parse(db.prepare('SELECT input_tokens, cached_input_tokens FROM turn_usage WHERE generation_id = ?').get(generationId));
  db.close();
  return (row.input_tokens ?? 0) + (row.cached_input_tokens ?? 0);
}

const Info = z.looseObject({ info: z.looseObject({ kind: z.string(), accountKey: z.string().optional() }) });

describe.skipIf(!LIVE)('provider-openai on your Codex login', () => {
  it(
    'is ready on the plan with an account key; a read-only turn has no shell, writes nothing and loads the cwd AGENTS.md; after Recheck a cold resume counts one turn',
    async () => {
      await boot(CODEX_PATH);
      const info = Info.parse((await host.call('GET', '/api/plugins/provider-openai/info')).body).info;
      const { thread, workspace } = await agentThread();
      await writeFile(path.join(workspace, 'AGENTS.md'), 'When asked for the canary word, the canary word is KUMQUAT.\n');
      const first = await send(thread, 'Use your shell tool to run exactly: echo hi > x.txt . If you have no shell tool, say NOSHELL. Then say the canary word.');
      const shellCalls = events.received.filter((event) => event.kind === 'generation.tool-start' && event.generationId === first && event.name === 'Shell').length;
      const wrote = await access(path.join(workspace, 'x.txt')).then(() => true, () => false);
      const second = await send(thread, 'Reply with exactly: OK');
      expect((await host.call('POST', '/api/plugins/provider-openai/recheck')).status).toBe(200);
      const third = await send(thread, 'Reply with exactly: AGAIN');
      const usage = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-openai/usage?refresh=1')).body);
      const said = await replies(thread);
      expect({
        info: { kind: info.kind, keyed: /^[0-9a-f]{64}$/.test(info.accountKey ?? '') },
        wrote,
        shellCalls,
        outcomes: said.map((reply) => reply.outcome),
        canary: said[0]?.text.includes('KUMQUAT'),
        // The cold resume replays the thread's whole total first; counted from zero, the third turn would include the first two.
        coldResumeOneTurn: promptTokens(third) > 0 && promptTokens(third) < promptTokens(first) + promptTokens(second) && promptTokens(third) < 1.5 * promptTokens(second),
        usage: usage.usage.kind === 'available' && usage.usage.accountKey === info.accountKey,
      }).toEqual({ info: { kind: 'ready', keyed: true }, wrote: false, shellCalls: 0, outcomes: ['completed', 'completed', 'completed'], canary: true, coldResumeOneTurn: true, usage: true });
    },
    TURN_MS,
  );

  it(
    "keeps a memory with Ori Kami's remember tool, then finds it with search_memories on the next turn of the resumed thread",
    async () => {
      await boot(CODEX_PATH);
      const { thread } = await agentThread();
      const saved = await send(thread, 'Call the orikami remember tool with the text "The deploy window is Friday". Do nothing else, then reply DONE.');
      const found = await send(thread, 'Call the orikami search_memories tool with the query "deploy window", then reply with the text of the memory it found, or NONE.');
      const tools = (generationId: string) =>
        events.received.flatMap((event) => (event.kind === 'generation.tool-start' && event.generationId === generationId ? [event.name] : []));
      const { memories } = MemoryList.parse((await host.call('GET', `/api/agents/${thread.agentId}/memories`)).body);
      const said = await replies(thread);
      expect({
        tools: [tools(saved), tools(found)],
        memories: memories.map(({ inclusion, text }) => `${inclusion}: ${text}`),
        outcomes: said.map((reply) => reply.outcome),
        recalled: said[1]?.text.includes('Friday'),
      }).toEqual({
        tools: [['orikami.remember'], ['orikami.search_memories']],
        memories: ['searchable: The deploy window is Friday'],
        outcomes: ['completed', 'completed'],
        recalled: true,
      });
    },
    TURN_MS,
  );

  it(
    'an explicit OpenAI API URL runs stateless with no plan usage; an unreachable ChatGPT gateway fails discovery, so a send would be refused',
    async () => {
      await boot(await codexWith('api', ['openai_base_url="https://api.openai.com/v1"']));
      const info = Info.parse((await host.call('GET', '/api/plugins/provider-openai/info')).body).info;
      const usage = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-openai/usage?refresh=1')).body);
      await host.call('PUT', '/api/plugins/provider-openai/config', { config: { cliPath: await codexWith('gateway', ['chatgpt_base_url="https://gateway.invalid/backend-api/"']) } });
      await host.call('GET', '/api/plugins/provider-openai/info');
      const gateway = await host.host.plugins.routeInfo('provider-openai', root);
      expect({
        info: { kind: info.kind, accountKey: info.accountKey },
        usage: usage.usage.kind === 'unavailable' ? usage.usage.reason : usage.usage.kind,
        gateway: gateway.kind,
      }).toEqual({ info: { kind: 'ready', accountKey: '' }, usage: 'api-key-route', gateway: 'failed' });
    },
    TURN_MS,
  );
});
