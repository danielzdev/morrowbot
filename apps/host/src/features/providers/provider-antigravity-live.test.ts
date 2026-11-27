import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, MessageList, SendMessageResponse, Thread, UsageResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGY } from '../../testing/agy-fixture.ts';
import { startTestHost, type EventClient, type TestHost } from '../../testing/test-host.ts';

/**
 * The §5 provider-antigravity fixtures, run through the host and the built-in provider on the real
 * agy you are signed in to (1.5.x; `MORROWBOT_AGY_PATH` or `agy` on PATH). They spend a little of
 * your plan, so they run only with `MORROWBOT_LIVE_AGY=1`.
 */
const LIVE = process.env.MORROWBOT_LIVE_AGY === '1';
const AGY_PATH = process.env.MORROWBOT_AGY_PATH ?? 'agy';
const TURN_MS = 300_000;

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
  const { generationId } = SendMessageResponse.parse(reply.body);
  await events.finished(generationId);
  return generationId;
}

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

const Info = z.looseObject({ info: z.looseObject({ kind: z.string(), accountKey: z.string().optional(), accountLabel: z.string().nullable().optional(), models: z.array(z.unknown()).optional() }) });

describe.skipIf(!LIVE)('provider-antigravity on your agy login', () => {
  it(
    'is ready once a session lists models; a read-only turn loads the workspace AGENTS.md, and its write and command are denied so nothing changes',
    async () => {
      const before = Info.parse((await host.call('GET', '/api/plugins/provider-antigravity/info')).body).info;
      const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Live', provider: AGY })).body);
      const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Live' })).body);
      await events.watch(thread.id);
      const workspace = path.join(root, 'data', 'workspaces', agent.id);
      await mkdir(workspace, { recursive: true });
      await writeFile(path.join(workspace, 'AGENTS.md'), 'When asked for the canary word, the canary word is KUMQUAT.\n');
      await send(thread, 'Say the canary word, and nothing else.');
      const changing = await send(thread, 'Use your command tool to run exactly: touch ran.txt . Then use your file tool to create inside.txt containing x.');
      const tools = events.received.flatMap((event) => (event.kind === 'generation.tool-start' && event.generationId === changing ? [event.name] : []));
      const after = Info.parse((await host.call('GET', '/api/plugins/provider-antigravity/info?refresh=1')).body).info;
      const usage = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-antigravity/usage?refresh=1')).body);
      const { messages } = MessageList.parse((await host.call('GET', `/api/threads/${thread.id}/messages`)).body);
      const said = messages.flatMap((message) => (message.kind === 'assistant' ? [{ outcome: message.outcome.kind, text: message.text }] : []));
      expect({
        before: before.kind,
        after: { kind: after.kind, accountKey: after.accountKey, labelled: (after.accountLabel ?? '') !== '', models: (after.models?.length ?? 0) > 0 },
        outcomes: said.map((reply) => reply.outcome),
        canary: said[0]?.text.includes('KUMQUAT'),
        askedToChange: tools.some((name) => name === 'Shell' || name === 'Edit'),
        changed: (await exists(path.join(workspace, 'ran.txt'))) || (await exists(path.join(workspace, 'inside.txt'))),
        usage: usage.usage.kind === 'unavailable' ? usage.usage.reason : usage.usage.kind,
      }).toEqual({
        before: 'ready-models-later',
        after: { kind: 'ready', accountKey: '', labelled: true, models: true },
        outcomes: ['completed', 'completed'],
        canary: true,
        askedToChange: true,
        changed: false,
        usage: 'unsupported',
      });
    },
    TURN_MS,
  );
});
