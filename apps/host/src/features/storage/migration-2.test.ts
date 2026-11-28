import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openStorage } from './index.ts';
import { MIGRATIONS } from './schema.ts';

const AT = '2026-01-01T00:00:00.000Z';
const WORKSPACE = JSON.stringify({ kind: 'shared', dir: '/work/shared' });
const AVATAR = JSON.stringify({ kind: 'initials', color: '#112233' });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-migration-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A database exactly as #4 left it: migration 1 only, `user_version = 1`. */
function buildV1(file: string, claudeConfig: object | undefined): void {
  const first = MIGRATIONS[0];
  if (first === undefined) throw new Error('migration 1 is missing');
  const db = new DatabaseSync(file);
  db.exec(first);
  db.exec('PRAGMA user_version = 1');
  const agent = db.prepare(
    `INSERT INTO agents (id, name, description, workspace, avatar, provider, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
  );
  const bindings: Record<string, object> = {
    claude: { kind: 'bound', pluginId: 'provider-claude', model: 'sonnet' },
    unbound: { kind: 'unbound' },
    local: { kind: 'bound', pluginId: 'local-llm', model: 'small' },
    'local-default': { kind: 'bound', pluginId: 'local-llm', model: 'default' },
  };
  for (const [id, binding] of Object.entries(bindings)) agent.run(id, id, WORKSPACE, AVATAR, JSON.stringify(binding), AT, AT);
  db.prepare('INSERT INTO threads (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('t1', 'claude', 'Plans', AT, AT);
  const message = db.prepare('INSERT INTO messages (id, thread_id, kind, text, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  message.run('m1', 't1', 'user', 'hi', null, AT);
  message.run('m2', 't1', 'assistant', 'done', JSON.stringify({ kind: 'completed' }), AT);
  message.run('m3', 't1', 'assistant', 'hal', JSON.stringify({ kind: 'stopped' }), AT);
  message.run('m4', 't1', 'assistant', '', JSON.stringify({ kind: 'failed', error: 'claude exited with code 1' }), AT);
  const config = db.prepare('INSERT INTO plugin_configs (plugin_id, config, updated_at) VALUES (?, ?, ?)');
  if (claudeConfig !== undefined) config.run('provider-claude', JSON.stringify(claudeConfig), AT);
  config.run('local-llm', JSON.stringify({ model: 'small', temperature: 0.2 }), AT);
  db.close();
}

async function migrated(claudeConfig: object | undefined) {
  const file = path.join(dir, `${String(Math.random())}.sqlite`);
  buildV1(file, claudeConfig);
  const storage = openStorage(file, () => AT);
  try {
    return {
      bindings: Object.fromEntries(storage.agents.list().map((agent) => [agent.id, agent.provider])),
      messages: storage.messages.listByThread('t1').map((message) => (message.kind === 'assistant' ? message.outcome : message.kind)),
      configs: {
        'provider-claude': (await storage.plugins.read('provider-claude'))?.config,
        'local-llm': (await storage.plugins.read('local-llm'))?.config,
      },
    };
  } finally {
    storage.close();
  }
}

it('migrates a populated #4 database: Claude takes its saved model setting, which is then removed', async () => {
  expect(await migrated({ cliPath: '/opt/claude', model: 'opus' })).toMatchInlineSnapshot(`
    {
      "bindings": {
        "claude": {
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
        "local": {
          "access": "read-only",
          "kind": "bound",
          "pluginId": "local-llm",
          "selection": {
            "choices": {},
            "id": "small",
            "kind": "model",
          },
          "vendorSettings": "isolated",
        },
        "local-default": {
          "access": "read-only",
          "kind": "bound",
          "pluginId": "local-llm",
          "selection": {
            "kind": "default",
          },
          "vendorSettings": "isolated",
        },
        "unbound": {
          "kind": "unbound",
        },
      },
      "configs": {
        "local-llm": {
          "model": "small",
          "temperature": 0.2,
        },
        "provider-claude": {
          "cliPath": "/opt/claude",
        },
      },
      "messages": [
        "user",
        {
          "finishReason": "stop",
          "kind": "completed",
        },
        {
          "kind": "cancelled",
        },
        {
          "error": {
            "kind": "other",
            "message": "claude exited with code 1",
          },
          "kind": "failed",
        },
      ],
    }
  `);
});

it('gives Claude the default selection when no model was saved, whatever the old binding said', async () => {
  const onlyPath = await migrated({ cliPath: '/opt/claude' });
  const noRow = await migrated(undefined);
  expect({
    onlyPath: { claude: onlyPath.bindings.claude, config: onlyPath.configs['provider-claude'] },
    noRow: { claude: noRow.bindings.claude, config: noRow.configs['provider-claude'] },
  }).toMatchInlineSnapshot(`
    {
      "noRow": {
        "claude": {
          "access": "read-only",
          "kind": "bound",
          "pluginId": "provider-claude",
          "selection": {
            "kind": "default",
          },
          "vendorSettings": "isolated",
        },
        "config": undefined,
      },
      "onlyPath": {
        "claude": {
          "access": "read-only",
          "kind": "bound",
          "pluginId": "provider-claude",
          "selection": {
            "kind": "default",
          },
          "vendorSettings": "isolated",
        },
        "config": {
          "cliPath": "/opt/claude",
        },
      },
    }
  `);
});

it('refuses a database newer than this host', () => {
  const file = path.join(dir, 'future.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${String(MIGRATIONS.length + 1)}`);
  db.close();
  expect(() => openStorage(file, () => AT)).toThrowErrorMatchingInlineSnapshot(`[Error: Database schema version 11 is newer than this host supports]`);
});
