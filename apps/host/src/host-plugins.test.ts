import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, PluginList, Thread } from '@morrowbot/contracts';
import { ECHO } from './testing/chat-fixture.ts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PLUGIN_FIXTURES, sequence, startTestHost, type TestHost } from './testing/test-host.ts';

let dataDir: string;
let host: TestHost | undefined;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-plugins-'));
});
afterEach(async () => {
  await host?.close();
  expect(host?.errors ?? []).toEqual([]);
  host = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

const start = (ids = sequence()) =>
  startTestHost({ dataDir, pluginsDir: PLUGIN_FIXTURES, sequence: ids });

async function echoThread(running: TestHost): Promise<Thread> {
  const agent = Agent.parse(
    (await running.call('POST', '/api/agents', { name: 'E', provider: ECHO }))
      .body,
  );
  await running.call('PUT', `/api/agents/${agent.id}/instructions`, { content: 'Be kind.', expectedRevision: null });
  return Thread.parse((await running.call('POST', `/api/agents/${agent.id}/threads`, {})).body);
}

it('switches plugins and saves their settings through the plugin host', async () => {
  const ids = sequence();
  host = await start(ids);
  const thread = await echoThread(host);
  const echo = async (running: TestHost) => {
    const list = PluginList.parse((await running.call('GET', '/api/plugins')).body);
    const entry = list.plugins.find((plugin) => plugin.manifest.id === 'echo');
    return { status: entry?.status, enabled: entry?.enabled, config: entry?.config };
  };
  const steps = {
    before: await echo(host),
    invalidConfig: (await host.call('PUT', '/api/plugins/echo/config', { config: { repeat: 9 } })).body,
    configured: (await host.call('PUT', '/api/plugins/echo/config', { config: { greeting: 'hey' } })).status,
    disabled: (await host.call('PUT', '/api/plugins/echo/enabled', { enabled: false })).status,
    sendWhileDisabled: (await host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'hi' })).body,
    unknown: (await host.call('PUT', '/api/plugins/missing/enabled', { enabled: true })).status,
  };
  await host.close();
  host = await start(ids);
  expect({ ...steps, afterRestart: await echo(host) }).toMatchInlineSnapshot(`
    {
      "afterRestart": {
        "config": {
          "greeting": "hey",
        },
        "enabled": false,
        "status": {
          "kind": "disabled",
        },
      },
      "before": {
        "config": {},
        "enabled": true,
        "status": {
          "kind": "running",
        },
      },
      "configured": 200,
      "disabled": 200,
      "invalidConfig": {
        "error": {
          "kind": "invalid_request",
          "message": "repeat: Too big: expected number to be <=3",
        },
      },
      "sendWhileDisabled": {
        "error": {
          "kind": "conflict",
          "message": "Provider plugin echo is not available: Plugin "echo" is not running (disabled)",
        },
      },
      "unknown": 404,
    }
  `);
});
