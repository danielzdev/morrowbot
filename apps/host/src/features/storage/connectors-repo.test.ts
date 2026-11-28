import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { openStorage } from './storage.ts';

let dir = '';
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('reads connector setups saved before Vault items as typed values', async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-connectors-repo-'));
  const file = path.join(dir, 'morrowbot.sqlite');
  const storage = openStorage(file, () => '2026-01-01T00:00:00.000Z');
  const old = {
    stdio: { kind: 'stdio', command: 'notes-server', args: [], env: [{ name: 'TOKEN', value: 'env-value' }] },
    http: { kind: 'http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer header-value' }] },
    composio: { kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/x', apiKey: 'composio-value', account: { kind: 'user', userId: 'me' } },
  };
  const raw = new DatabaseSync(file);
  for (const [id, setup] of Object.entries(old)) {
    raw
      .prepare(
        `INSERT INTO connectors (id, label, label_key, setup, enabled, connected, scope_mode, scope_revision, scope_review_required, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, 'all', 0, 0, '2026-01-01', '2026-01-01')`,
      )
      .run(id, id, id, JSON.stringify(setup));
  }
  raw.close();
  const setups = storage.connectors.list().map(({ setup }) => setup);
  storage.close();
  expect(setups).toMatchInlineSnapshot(`
    [
      {
        "account": {
          "kind": "user",
          "userId": "me",
        },
        "apiKey": {
          "kind": "inline",
          "value": "composio-value",
        },
        "kind": "composio",
        "serverUrl": "https://backend.composio.dev/v3/mcp/x",
        "toolkit": "gmail",
      },
      {
        "headers": [
          {
            "kind": "inline",
            "name": "Authorization",
            "value": "Bearer header-value",
          },
        ],
        "kind": "http",
        "url": "https://example.com/mcp",
      },
      {
        "args": [],
        "command": "notes-server",
        "env": [
          {
            "kind": "inline",
            "name": "TOKEN",
            "value": "env-value",
          },
        ],
        "kind": "stdio",
      },
    ]
  `);
});
