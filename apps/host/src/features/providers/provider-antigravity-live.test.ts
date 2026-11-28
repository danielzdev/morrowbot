import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, MessageList, StartedSend, Thread, UsageResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGY } from '../../testing/agy-fixture.ts';
import { isRunning, until } from '../../testing/daemon-fixture.ts';
import { startTestHost, type EventClient, type TestHost } from '../../testing/test-host.ts';

/**
 * The §5 provider-antigravity fixtures, run through the host and the built-in provider on the real
 * agy you are signed in to (1.5.x; `MORROWBOT_AGY_PATH` or `agy` on PATH). They spend a little of
 * your plan, so they run only with `MORROWBOT_LIVE_AGY=1`.
 */
const LIVE = process.env.MORROWBOT_LIVE_AGY === '1';
const AGY_PATH = process.env.MORROWBOT_AGY_PATH ?? 'agy';
const TURN_MS = 600_000;

let root = '';
let host: TestHost;
let events: EventClient;

beforeEach(async () => {
  if (!LIVE) return;
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-live-agy-')));
  host = await startTestHost({ dataDir: path.join(root, 'data') });
  events = await host.events();
  const configured = await host.call('PUT', '/api/plugins/provider-antigravity/config', { config: { cliPath: AGY_PATH } });
  if (configured.status !== 200) throw new Error(JSON.stringify(configured.body));
});

afterEach(async () => {
  if (!LIVE) return;
  await host.close();
  await rm(root, { recursive: true, force: true });
});

async function send(thread: Thread, text: string): Promise<string> {
  const reply = await host.call('POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice: { kind: 'auto' } });
  const { generationId } = StartedSend.parse(reply.body);
  await events.finished(generationId);
  return generationId;
}

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

const Info = z.looseObject({ info: z.looseObject({ kind: z.string(), accountKey: z.string().optional(), accountLabel: z.string().nullable().optional(), models: z.array(z.unknown()).optional() }) });

/** The tool calls of one turn, as `Name:outcome`. */
function toolsOf(generationId: string): string[] {
  const ends = new Map(events.received.flatMap((event) => (event.kind === 'generation.tool-end' && event.generationId === generationId ? [[event.toolUseId, event.outcome]] : [])));
  return events.received.flatMap((event) => (event.kind === 'generation.tool-start' && event.generationId === generationId ? [`${event.name}:${ends.get(event.toolUseId) ?? 'open'}`] : []));
}

/** Whether MorrowBot itself denied a `kind` tool in that turn (its status says so), rather than agy failing it. */
function deniedByMorrowBot(generationId: string, kind: string): boolean {
  return events.received.some((event) => event.kind === 'generation.status' && event.generationId === generationId && (event.detail ?? '').startsWith(`Denied ${kind} `));
}

describe.skipIf(!LIVE)('provider-antigravity on your agy login', () => {
  it(
    "is ready with models on the first provider-info; a read-only turn follows both the agent's SOUL.md and the workspace AGENTS.md; a write inside, a write outside, a command and a write through a symlink are each denied and change nothing",
    async () => {
      const before = Info.parse((await host.call('GET', '/api/plugins/provider-antigravity/info')).body).info;
      const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Live', provider: AGY })).body);
      const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Live' })).body);
      await events.watch(thread.id);
      const workspace = path.join(root, 'data', 'workspaces', agent.id);
      const outside = path.join(root, 'outside');
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(outside, path.join(workspace, 'escape'));
      await writeFile(path.join(workspace, 'SOUL.md'), 'When asked for the canary word, the canary word is KUMQUAT.\n');
      await writeFile(path.join(workspace, 'AGENTS.md'), 'When asked for the repository code word, the repository code word is PAPAYA.\n');
      await send(thread, 'Say the canary word and the repository code word, and nothing else.');
      const tries = [
        { prompt: 'Use your file-writing tool to create inside.txt containing x. Do not use any other tool.', target: path.join(workspace, 'inside.txt'), tool: 'Edit', kind: 'edit' },
        { prompt: `Use your file-writing tool to create ${path.join(outside, 'written.txt')} containing x. Do not use any other tool.`, target: path.join(outside, 'written.txt'), tool: 'Edit', kind: 'edit' },
        { prompt: 'Use your command tool to run exactly: touch ran.txt . Do not use any other tool.', target: path.join(workspace, 'ran.txt'), tool: 'Shell', kind: 'execute' },
        { prompt: 'Use your file-writing tool to create escape/linked.txt containing x. Do not use any other tool.', target: path.join(outside, 'linked.txt'), tool: 'Edit', kind: 'edit' },
      ];
      const denied: unknown[] = [];
      for (const attempt of tries) {
        const generationId = await send(thread, attempt.prompt);
        const tools = toolsOf(generationId);
        denied.push({ tool: attempt.tool, reachedDenial: tools.includes(`${attempt.tool}:error`), byMorrowBot: deniedByMorrowBot(generationId, attempt.kind), anyToolSucceeded: tools.some((tool) => tool.endsWith(':ok')), changed: await exists(attempt.target) });
      }
      const after = Info.parse((await host.call('GET', '/api/plugins/provider-antigravity/info')).body).info;
      const usage = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-antigravity/usage?refresh=1')).body);
      const { messages } = MessageList.parse((await host.call('GET', `/api/threads/${thread.id}/messages`)).body);
      const said = messages.flatMap((message) => (message.kind === 'assistant' ? [{ outcome: message.outcome.kind, text: message.text }] : []));
      expect({
        before: before.kind,
        after: { kind: after.kind, accountKey: after.accountKey, labelled: (after.accountLabel ?? '') !== '', models: (after.models?.length ?? 0) > 0 },
        outcomes: said.map((reply) => reply.outcome),
        canary: said[0]?.text.includes('KUMQUAT'),
        repository: said[0]?.text.includes('PAPAYA'),
        denied,
        usage: usage.usage.kind === 'unavailable' ? usage.usage.reason : usage.usage.kind,
        errors: host.errors,
      }).toEqual({
        before: 'ready',
        after: { kind: 'ready', accountKey: '', labelled: true, models: true },
        outcomes: ['completed', 'completed', 'completed', 'completed', 'completed'],
        canary: true,
        repository: true,
        denied: tries.map(({ tool }) => ({ tool, reachedDenial: true, byMorrowBot: true, anyToolSucceeded: false, changed: false })),
        usage: 'unsupported',
        errors: [],
      });
    },
    TURN_MS,
  );

  it(
    "offers full access with each model's thinking levels on the first provider-info; a full-access command runs without a card, and Stop ends a long command",
    async () => {
      const Models = z.looseObject({ info: z.looseObject({ models: z.array(z.looseObject({ options: z.array(z.unknown()) })) }) });
      const { models } = Models.parse((await host.call('GET', '/api/plugins/provider-antigravity/info')).body).info;
      const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Live full', provider: { ...AGY, access: 'full' } })).body);
      const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Live full' })).body);
      await events.watch(thread.id);
      const workspace = path.join(root, 'data', 'workspaces', agent.id);
      const ran = await send(thread, 'Use your command tool to run exactly: touch ran.txt . Do not use any other tool.');
      const reply = await host.call('POST', `/api/threads/${thread.id}/messages`, {
        text: "Use your command tool to run exactly this command in the foreground and wait for it to finish (it takes five minutes): sh -c 'echo $$ > child.pid; exec sleep 300'",
        sessionChoice: { kind: 'auto' },
      });
      const { generationId } = StartedSend.parse(reply.body);
      await until(() => exists(path.join(workspace, 'child.pid')), 120_000);
      await until(async () => (await readFile(path.join(workspace, 'child.pid'), 'utf8')).trim() !== '');
      const pid = Number((await readFile(path.join(workspace, 'child.pid'), 'utf8')).trim());
      const runningBefore = isRunning(pid);
      const stop = await host.call('POST', `/api/threads/${thread.id}/stop`);
      await events.finished(generationId);
      await until(() => !isRunning(pid));
      const { messages } = MessageList.parse((await host.call('GET', `/api/threads/${thread.id}/messages`)).body);
      expect({
        thinkingModels: models.some((model) => model.options.length > 0),
        ran: await exists(path.join(workspace, 'ran.txt')),
        cards: events.received.some((event) => event.kind === 'generation.approval-requested' && event.generationId === ran),
        stop: stop.status,
        runningBefore,
        runningAfter: isRunning(pid),
        outcomes: messages.flatMap((message) => (message.kind === 'assistant' ? [message.outcome.kind] : [])),
        errors: host.errors,
      }).toEqual({ thinkingModels: true, ran: true, cards: false, stop: 200, runningBefore: true, runningAfter: false, outcomes: ['completed', 'cancelled'], errors: [] });
    },
    TURN_MS,
  );
});
