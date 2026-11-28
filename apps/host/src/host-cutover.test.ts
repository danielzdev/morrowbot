import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MessageList, StartedSend } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MIGRATIONS } from './features/storage/index.ts';
import { startTestHost, type TestHost } from './testing/test-host.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('./features/providers/fixtures/fake-claude.ts', import.meta.url));
const AT = '2026-01-01T00:00:00.000Z';

let home = '';
let host: TestHost | undefined;
afterEach(async () => {
  await host?.close();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
  expect(host?.errors ?? []).toEqual([]);
  host = undefined;
});

/** A data folder exactly as #4 left it: one Claude agent with a thread, and Claude's saved `model` setting. */
async function buildV1(dataDir: string, workspace: string): Promise<void> {
  const first = MIGRATIONS[0];
  if (first === undefined) throw new Error('migration 1 is missing');
  await mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'morrowbot.sqlite'));
  db.exec(first);
  db.exec('PRAGMA user_version = 1');
  db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, created_at, updated_at) VALUES ('a1', 'Planner', '', ?, ?, ?, ?, ?)`,
  ).run(
    JSON.stringify({ kind: 'shared', dir: workspace }),
    JSON.stringify({ kind: 'initials', color: '#112233' }),
    JSON.stringify({ kind: 'bound', pluginId: 'provider-claude', model: 'default' }),
    AT,
    AT,
  );
  db.prepare(`INSERT INTO threads (id, agent_id, title, created_at, updated_at) VALUES ('t1', 'a1', 'Plans', ?, ?)`).run(AT, AT);
  const message = db.prepare('INSERT INTO messages (id, thread_id, kind, text, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  message.run('m1', 't1', 'user', 'hi', null, AT);
  message.run('m2', 't1', 'assistant', 'hal', JSON.stringify({ kind: 'stopped' }), AT);
  db.prepare(`INSERT INTO plugin_configs (plugin_id, config, updated_at) VALUES ('provider-claude', ?, ?)`).run(
    JSON.stringify({ cliPath: FAKE_CLAUDE, model: 'opus' }),
    AT,
  );
  db.close();
}

const Invocation = z.object({ args: z.array(z.string()), stdin: z.string().nullable() });

it('upgrades a #4 data folder and answers the next two messages through the built-in Claude provider with the saved model', async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-cutover-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  vi.stubEnv('USER', 'tester');
  const workspace = path.join(home, 'work');
  await mkdir(workspace);
  const dataDir = path.join(home, 'data');
  await buildV1(dataDir, workspace);
  host = await startTestHost({ dataDir });
  const events = await host.events();
  events.subscribe('t1', null);
  for (const text of ['next step?', 'and then?']) {
    const reply = await host.call('POST', '/api/threads/t1/messages', { text, sessionChoice: { kind: 'auto' } });
    await events.finished(StartedSend.parse(reply.body).generationId);
  }
  const agent = (await host.call('GET', '/api/agents/a1')).body;
  const { messages } = MessageList.parse((await host.call('GET', '/api/threads/t1/messages')).body);
  const log = await readFile(path.join(home, 'fake-claude', 'log.jsonl'), 'utf8');
  const turns = log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => Invocation.parse(JSON.parse(line)))
    .filter(({ args }) => args[0] === '-p');
  expect({
    binding: typeof agent === 'object' && agent !== null && 'provider' in agent ? agent.provider : null,
    models: turns.map(({ args }) => args[args.indexOf('--model') + 1]),
    lastStdin: turns.at(-1)?.stdin,
    history: messages.map((message) => (message.kind === 'user' ? `user: ${message.text}` : `assistant(${message.outcome.kind}): ${message.text}`)),
  }).toMatchInlineSnapshot(`
    {
      "binding": {
        "access": "read-only",
        "kind": "bound",
        "pluginId": "provider-claude",
        "selection": {
          "choices": {},
          "id": "opus",
          "kind": "model",
        },
        "vendorSettings": "isolated",
      },
      "history": [
        "user: hi",
        "assistant(cancelled): hal",
        "user: next step?",
        "assistant(completed): You said: next step?",
        "user: and then?",
        "assistant(completed): You said: and then?",
      ],
      "lastStdin": "Continue this conversation. Reply to the last user message.

    <conversation>
    <user>
    hi
    </user>
    <assistant>
    hal
    </assistant>
    <user>
    next step?
    </user>
    <assistant>
    You said: next step?
    </assistant>
    <user>
    and then?
    </user>
    </conversation>",
      "models": [
        "opus",
        "opus",
      ],
    }
  `);
});
