import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, type ChatProvider, type ProviderEvent, Thread } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sequence, startTestHost, type TestHost } from './testing/test-host.ts';

const hello: ChatProvider = {
  generate: () => ReadableStream.from<ProviderEvent>([{ kind: 'text', text: 'hi there' }]),
};

let dataDir: string;
let host: TestHost | undefined;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-api-'));
});
afterEach(async () => {
  await host?.close();
  host = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

function redact(value: unknown): unknown {
  const redacted: unknown = JSON.parse(JSON.stringify(value).replaceAll(dataDir, '<data>'));
  return redacted;
}

it('keeps agents, threads, messages and AGENTS.md across a host restart', async () => {
  const ids = sequence();
  const first = await startTestHost({ dataDir, providers: { hello }, sequence: ids });
  const agent = Agent.parse(
    (await first.call('POST', '/api/agents', { name: 'Keeper', provider: { kind: 'bound', pluginId: 'hello', model: 'm' } }))
      .body,
  );
  await first.call('PUT', `/api/agents/${agent.id}/instructions`, { content: '# Keeper\nRemember.' });
  const thread = Thread.parse((await first.call('POST', `/api/agents/${agent.id}/threads`, {})).body);
  const events = await first.events();
  await first.call('POST', `/api/threads/${thread.id}/messages`, { text: 'remember me' });
  await events.finished(thread.id);
  await first.close();

  host = await startTestHost({ dataDir, providers: { hello }, sequence: ids });
  expect(
    redact({
      agents: (await host.call('GET', '/api/agents')).body,
      instructions: (await host.call('GET', `/api/agents/${agent.id}/instructions`)).body,
      threads: (await host.call('GET', `/api/agents/${agent.id}/threads`)).body,
      messages: (await host.call('GET', `/api/threads/${thread.id}/messages`)).body,
    }),
  ).toMatchInlineSnapshot(`
    {
      "agents": {
        "agents": [
          {
            "avatar": {
              "color": "#6b7280",
              "kind": "initials",
            },
            "createdAt": "2026-01-01T00:00:00.000Z",
            "description": "",
            "id": "id-1",
            "name": "Keeper",
            "provider": {
              "kind": "bound",
              "model": "m",
              "pluginId": "hello",
            },
            "updatedAt": "2026-01-01T00:00:00.000Z",
            "workspace": {
              "dir": "<data>/workspaces/id-1",
              "kind": "dedicated",
            },
          },
        ],
      },
      "instructions": {
        "content": "# Keeper
    Remember.",
      },
      "messages": {
        "messages": [
          {
            "createdAt": "2026-01-01T00:00:02.000Z",
            "id": "id-4",
            "kind": "user",
            "text": "remember me",
            "threadId": "id-3",
          },
          {
            "createdAt": "2026-01-01T00:00:04.000Z",
            "id": "id-6",
            "kind": "assistant",
            "outcome": {
              "kind": "completed",
            },
            "text": "hi there",
            "threadId": "id-3",
          },
        ],
      },
      "threads": {
        "threads": [
          {
            "agentId": "id-1",
            "createdAt": "2026-01-01T00:00:01.000Z",
            "id": "id-3",
            "title": "New chat",
            "updatedAt": "2026-01-01T00:00:05.000Z",
          },
        ],
      },
    }
  `);
});

it('creates, updates and deletes agents and threads', async () => {
  host = await startTestHost({ dataDir });
  const shared = path.join(dataDir, 'team');
  const dedicated = Agent.parse((await host.call('POST', '/api/agents', { name: 'Solo', description: 'Own folder' })).body);
  const sharing = Agent.parse(
    (await host.call('POST', '/api/agents', { name: 'Pair', workspace: { kind: 'shared', dir: shared } })).body,
  );
  await access(dedicated.workspace.dir);
  await access(shared);
  const thread = Thread.parse((await host.call('POST', `/api/agents/${sharing.id}/threads`, { title: 'Old' })).body);

  const steps = {
    renamedAgent: await host.call('PATCH', `/api/agents/${dedicated.id}`, {
      name: 'Solo 2',
      provider: { kind: 'bound', pluginId: 'hello', model: 'big' },
    }),
    renamedThread: await host.call('PATCH', `/api/threads/${thread.id}`, { title: 'New' }),
    missingInstructions: await host.call('GET', `/api/agents/${sharing.id}/instructions`),
    deleteAgent: await host.call('DELETE', `/api/agents/${sharing.id}`),
    threadAfterAgentDeleted: await host.call('GET', `/api/threads/${thread.id}`),
    deleteAgain: await host.call('DELETE', `/api/agents/${sharing.id}`),
    agents: await host.call('GET', '/api/agents'),
  };
  expect(redact(steps)).toMatchInlineSnapshot(`
    {
      "agents": {
        "body": {
          "agents": [
            {
              "avatar": {
                "color": "#6b7280",
                "kind": "initials",
              },
              "createdAt": "2026-01-01T00:00:00.000Z",
              "description": "Own folder",
              "id": "id-1",
              "name": "Solo 2",
              "provider": {
                "kind": "bound",
                "model": "big",
                "pluginId": "hello",
              },
              "updatedAt": "2026-01-01T00:00:03.000Z",
              "workspace": {
                "dir": "<data>/workspaces/id-1",
                "kind": "dedicated",
              },
            },
          ],
        },
        "status": 200,
      },
      "deleteAgain": {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Agent not found",
          },
        },
        "status": 404,
      },
      "deleteAgent": {
        "body": null,
        "status": 204,
      },
      "missingInstructions": {
        "body": {
          "content": "",
        },
        "status": 200,
      },
      "renamedAgent": {
        "body": {
          "avatar": {
            "color": "#6b7280",
            "kind": "initials",
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "description": "Own folder",
          "id": "id-1",
          "name": "Solo 2",
          "provider": {
            "kind": "bound",
            "model": "big",
            "pluginId": "hello",
          },
          "updatedAt": "2026-01-01T00:00:03.000Z",
          "workspace": {
            "dir": "<data>/workspaces/id-1",
            "kind": "dedicated",
          },
        },
        "status": 200,
      },
      "renamedThread": {
        "body": {
          "agentId": "id-2",
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-3",
          "title": "New",
          "updatedAt": "2026-01-01T00:00:04.000Z",
        },
        "status": 200,
      },
      "threadAfterAgentDeleted": {
        "body": {
          "error": {
            "kind": "not_found",
            "message": "Thread not found",
          },
        },
        "status": 404,
      },
    }
  `);
  await access(shared);
});

it('manages plugin switches and settings and keeps them', async () => {
  const plugin = { id: 'hello', name: 'Hello', version: '1.0.0' };
  host = await startTestHost({ dataDir, plugins: [plugin] });
  const steps = {
    before: (await host.call('GET', '/api/plugins')).body,
    disable: (await host.call('PUT', '/api/plugins/hello/enabled', { enabled: false })).body,
    configure: (await host.call('PUT', '/api/plugins/hello/config', { config: { greeting: 'hey', loud: true } })).body,
    unknown: (await host.call('PUT', '/api/plugins/missing/enabled', { enabled: true })).status,
  };
  await host.close();
  host = await startTestHost({ dataDir, plugins: [plugin] });
  expect({ ...steps, afterRestart: (await host.call('GET', '/api/plugins')).body }).toMatchInlineSnapshot(`
    {
      "afterRestart": {
        "plugins": [
          {
            "config": {
              "greeting": "hey",
              "loud": true,
            },
            "enabled": false,
            "manifest": {
              "id": "hello",
              "name": "Hello",
              "version": "1.0.0",
            },
          },
        ],
      },
      "before": {
        "plugins": [
          {
            "config": {},
            "enabled": true,
            "manifest": {
              "id": "hello",
              "name": "Hello",
              "version": "1.0.0",
            },
          },
        ],
      },
      "configure": {
        "config": {
          "greeting": "hey",
          "loud": true,
        },
        "enabled": false,
        "manifest": {
          "id": "hello",
          "name": "Hello",
          "version": "1.0.0",
        },
      },
      "disable": {
        "config": {},
        "enabled": false,
        "manifest": {
          "id": "hello",
          "name": "Hello",
          "version": "1.0.0",
        },
      },
      "unknown": 404,
    }
  `);
});
