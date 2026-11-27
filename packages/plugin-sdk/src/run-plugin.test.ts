import { afterEach, expect, it } from 'vitest';
import { startPlugin, turnFrame, type PluginUnderTest } from './testing/plugin-driver.ts';

const plugins: PluginUnderTest[] = [];
afterEach(async () => {
  await Promise.all(plugins.splice(0).map((plugin) => plugin.killHard()));
});

function start(kind: 'provider' | 'tool'): PluginUnderTest {
  const plugin = startPlugin({ kind });
  plugins.push(plugin);
  return plugin;
}

it('ignores an init for another protocol version and answers the next valid request', async () => {
  const plugin = start('provider');
  plugin.send({ kind: 'init', id: 1, protocolVersion: 2, config: {}, dataDir: '/tmp/data' });
  plugin.send({ kind: 'health', id: 2 });
  await plugin.next('health-result');
  plugin.send({ kind: 'init', id: 3, protocolVersion: 1, config: {}, dataDir: '/tmp/data' });
  await plugin.next('init-result');
  expect({
    received: plugin.received,
    loggedRefusal: plugin.stderr().includes('ignored a malformed host message'),
  }).toMatchInlineSnapshot(`
    {
      "loggedRefusal": true,
      "received": [
        {
          "health": {
            "kind": "ok",
          },
          "id": 2,
          "kind": "health-result",
        },
        {
          "id": 3,
          "kind": "init-result",
          "pluginKind": "provider",
          "protocolVersion": 1,
        },
      ],
    }
  `);
});

it('ends a turn whose handler throws as failed{other}', async () => {
  const plugin = start('provider');
  plugin.send(turnFrame('turn-1', '/', { kind: 'throw', message: 'the handler broke' }));
  expect(await plugin.next('turn-end')).toMatchInlineSnapshot(`
    {
      "accountKey": "",
      "actualModel": null,
      "finalText": null,
      "kind": "turn-end",
      "outcome": {
        "error": {
          "kind": "other",
          "message": "the handler broke",
        },
        "kind": "failed",
      },
      "sessionTouched": true,
      "turnId": "turn-1",
      "usage": {
        "kind": "unavailable",
      },
    }
  `);
});

it('answers provider requests to a tool plugin as unsupported, and a throwing hook as failed', async () => {
  const tool = start('tool');
  const provider = start('provider');
  tool.send({ kind: 'provider-info', id: 7, refresh: false });
  provider.send({ kind: 'provider-info', id: 8, refresh: false });
  expect({ tool: await tool.next('error'), provider: await provider.next('error') }).toMatchInlineSnapshot(`
    {
      "provider": {
        "code": "failed",
        "id": 8,
        "kind": "error",
        "message": "provider info is not set up in this fixture",
      },
      "tool": {
        "code": "unsupported",
        "id": 7,
        "kind": "error",
        "message": "Tool plugins do not run provider requests",
      },
    }
  `);
});
