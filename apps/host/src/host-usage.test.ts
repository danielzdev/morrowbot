import { afterEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let fixture: ChatFixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

it('lists every chat newest first, and sums the tokens each turn reported (H5, H9)', async () => {
  fixture = await startChatFixture();
  const first = await fixture.agent();
  const second = await fixture.agent();
  const older = await fixture.thread(first, 'Groceries');
  const newer = await fixture.thread(second, 'Reading list');
  await fixture.send(older, 'hello');
  await fixture.send(older, 'final-only');
  await fixture.send(newer, 'hi');
  const { host } = fixture;
  const threads = await host.call('GET', '/api/threads');
  const tokens = await host.call('GET', '/api/usage/tokens?range=24h');
  const bad = await host.call('GET', '/api/usage/tokens?range=forever');
  expect({
    threads: { status: threads.status, body: threads.body },
    tokens: { status: tokens.status, body: tokens.body },
    bad: bad.status,
    agents: [first.id, second.id],
  }).toMatchInlineSnapshot(`
    {
      "agents": [
        "id-1",
        "id-2",
      ],
      "bad": 400,
      "threads": {
        "body": {
          "threads": [
            {
              "agentId": "id-2",
              "createdAt": "2026-01-01T00:00:03.000Z",
              "id": "id-4",
              "title": "Reading list",
              "updatedAt": "2026-01-01T00:00:12.000Z",
            },
            {
              "agentId": "id-1",
              "createdAt": "2026-01-01T00:00:02.000Z",
              "id": "id-3",
              "title": "Groceries",
              "updatedAt": "2026-01-01T00:00:09.000Z",
            },
          ],
        },
        "status": 200,
      },
      "tokens": {
        "body": {
          "range": "24h",
          "since": "2025-12-31T00:00:13.000Z",
          "totals": [
            {
              "agentId": "id-1",
              "cachedInputTokens": null,
              "inputTokens": null,
              "model": null,
              "outputTokens": null,
              "pluginId": "echo",
              "reasoningTokens": null,
              "turns": 1,
              "turnsWithoutCounts": 1,
            },
            {
              "agentId": "id-1",
              "cachedInputTokens": null,
              "inputTokens": 3,
              "model": "tiny",
              "outputTokens": 2,
              "pluginId": "echo",
              "reasoningTokens": null,
              "turns": 1,
              "turnsWithoutCounts": 0,
            },
            {
              "agentId": "id-2",
              "cachedInputTokens": null,
              "inputTokens": 3,
              "model": "tiny",
              "outputTokens": 2,
              "pluginId": "echo",
              "reasoningTokens": null,
              "turns": 1,
              "turnsWithoutCounts": 0,
            },
          ],
        },
        "status": 200,
      },
    }
  `);
});
