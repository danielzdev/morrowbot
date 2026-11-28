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

it('refuses a pending approval as soon as its turn is cancelled, and ignores a reply that comes after', async () => {
  const plugin = start('provider');
  plugin.send(turnFrame('turn-1', '/', { kind: 'ask', summary: 'Write .git/x' }));
  const { chunk } = await plugin.next('turn-chunk');
  const approvalId = chunk.kind === 'approval-request' ? chunk.approvalId : '';
  plugin.send({ kind: 'cancel', turnId: 'turn-1' });
  plugin.send({ kind: 'approval-reply', turnId: 'turn-1', approvalId, choiceId: 'allow' });
  const end = await plugin.next('turn-end');
  expect({ outcome: end.outcome, answer: end.finalText }).toEqual({
    outcome: { kind: 'cancelled' },
    answer: JSON.stringify({ kind: 'refused', reason: 'turn-ended' }),
  });
});

it('serves tools-list, tool-call and tool-cancel on tool plugins and rejects them on provider plugins', async () => {
  const tool = start('tool');
  const provider = start('provider');
  tool.send({ kind: 'tools-list', id: 1 });
  provider.send({ kind: 'tools-list', id: 2 });
  tool.send({ kind: 'tool-call', id: 3, turnId: 'turn-1', name: 'ping', input: { text: 'hi' } });
  tool.send({ kind: 'tool-call', id: 4, turnId: 'turn-1', name: 'wait', input: {} });
  tool.send({ kind: 'tool-cancel', callId: 4 });
  tool.send({ kind: 'tool-call', id: 5, turnId: 'turn-1', name: 'boom', input: {} });

  const listed = await tool.next('tools-list-result');
  const providerErr = await provider.next('error');
  const ping = await tool.next('tool-call-result');
  const cancelled = await tool.next('tool-call-result');
  const boom = await tool.next('error');

  expect({
    listedTools: listed.tools.map((item) => item.name),
    providerErr,
    ping,
    cancelled,
    boom,
  }).toMatchInlineSnapshot(`
    {
      "boom": {
        "code": "failed",
        "id": 5,
        "kind": "error",
        "message": "tool exploded",
      },
      "cancelled": {
        "id": 4,
        "kind": "tool-call-result",
        "result": {
          "kind": "error",
          "message": "aborted",
        },
      },
      "listedTools": [
        "ping",
        "wait",
        "boom",
      ],
      "ping": {
        "id": 3,
        "kind": "tool-call-result",
        "result": {
          "content": [
            {
              "kind": "text",
              "text": "pong:{"text":"hi"}",
            },
          ],
          "kind": "ok",
        },
      },
      "providerErr": {
        "code": "unsupported",
        "id": 2,
        "kind": "error",
        "message": "Provider plugins do not run tool requests",
      },
    }
  `);
});
