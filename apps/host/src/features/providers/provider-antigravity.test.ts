import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type AgyFixture, FAKE_AGY, startAgyFixture, turnMethods } from '../../testing/agy-fixture.ts';

let agy: AgyFixture;

beforeEach(async () => {
  agy = await startAgyFixture();
});

afterEach(async () => {
  await agy.close();
  expect(agy.host.errors).toEqual([]);
});

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(FAKE_AGY, '<fake-agy>').replaceAll(agy.home, '$HOME').replace(/sess-\d+-/g, 'sess-<pid>-'));
}

function without(event: object, keys: readonly string[]): unknown {
  return Object.fromEntries(Object.entries(event).filter(([key]) => !keys.includes(key)));
}

function usageOf(generationId: string): unknown {
  const db = new DatabaseSync(path.join(agy.home, 'data', 'morrowbot.sqlite'), { readOnly: true });
  const row = db
    .prepare('SELECT actual_model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens FROM turn_usage WHERE generation_id = ?')
    .get(generationId);
  db.close();
  return row;
}

it('reports ready with every model, its thinking levels and the plan on the first provider-info, from a probe session it closes, starting one daemon with its own --gemini-dir', async () => {
  const before = agy.daemonPgids().length;
  const first = await agy.host.call('GET', '/api/plugins/provider-antigravity/info');
  const log = await agy.logged('session/close', 1);
  expect(
    redact({
      before,
      after: agy.daemonPgids().length,
      launches: (await agy.launches()).map((launch) => launch.args),
      probe: log.filter((entry) => entry.method !== 'initialize').map((entry) => ({ method: entry.method, params: entry.params })),
      first: first.body,
    }),
  ).toMatchInlineSnapshot(`
    {
      "after": 1,
      "before": 0,
      "first": {
        "info": {
          "accountKey": "",
          "accountLabel": "Google AI Pro",
          "capabilities": {
            "approvals": true,
            "profiles": [
              {
                "access": "read-only",
                "modes": [
                  "interactive",
                ],
                "readsOutsideCwd": true,
                "vendorSettings": "personal",
              },
              {
                "access": "full",
                "modes": [
                  "interactive",
                  "background",
                ],
                "readsOutsideCwd": true,
                "vendorSettings": "personal",
              },
            ],
            "sessions": false,
            "usage": "none",
            "withheld": [
              {
                "access": "workspace-write",
                "reason": "MorrowBot can't yet confine Antigravity's file writes to the workspace, and agy runs commands outside any sandbox. Use Full access instead.",
                "vendorSettings": "personal",
              },
              {
                "access": "read-only",
                "reason": "Antigravity always loads the workspace's own AGENTS.md (checked on agy 1.5.18), so MorrowBot cannot replace its instructions. MorrowBot still sends the agent's SOUL.md.",
                "vendorSettings": "isolated",
              },
              {
                "access": "workspace-write",
                "reason": "Antigravity always loads the workspace's own AGENTS.md (checked on agy 1.5.18), so MorrowBot cannot replace its instructions. MorrowBot still sends the agent's SOUL.md.",
                "vendorSettings": "isolated",
              },
              {
                "access": "full",
                "reason": "Antigravity always loads the workspace's own AGENTS.md (checked on agy 1.5.18), so MorrowBot cannot replace its instructions. MorrowBot still sends the agent's SOUL.md.",
                "vendorSettings": "isolated",
              },
            ],
          },
          "kind": "ready",
          "models": [
            {
              "id": "fake-pro",
              "isDefault": true,
              "label": "Fake Pro",
              "options": [
                {
                  "choices": [
                    {
                      "id": "low",
                      "label": "LOW",
                    },
                    {
                      "id": "high",
                      "label": "HIGH",
                    },
                  ],
                  "defaultChoiceId": "high",
                  "id": "thought_level",
                  "label": "Thinking Level",
                },
              ],
            },
            {
              "id": "fake-flash",
              "isDefault": false,
              "label": "Fake Flash",
              "options": [
                {
                  "choices": [
                    {
                      "id": "minimal",
                      "label": "MINIMAL",
                    },
                    {
                      "id": "low",
                      "label": "LOW",
                    },
                  ],
                  "defaultChoiceId": "low",
                  "id": "thought_level",
                  "label": "Thinking Level",
                },
              ],
            },
          ],
          "version": "1.5.18",
          "warning": null,
        },
      },
      "launches": [
        [
          "acp",
          "--gemini-dir",
          "$HOME/data/plugin-data/provider-antigravity/gemini",
        ],
      ],
      "probe": [
        {
          "method": "session/new",
          "params": {
            "cwd": "$HOME/data/plugin-data/provider-antigravity",
            "mcpServers": [],
          },
        },
        {
          "method": "session/set_config_option",
          "params": {
            "configId": "model",
            "sessionId": "sess-<pid>-1",
            "value": "fake-flash",
          },
        },
        {
          "method": "session/close",
          "params": {
            "sessionId": "sess-<pid>-1",
          },
        },
      ],
    }
  `);
});

it('streams a new session in Default mode, counts its tokens, closes it, and seeds the next turn with the conversation', async () => {
  const thread = await agy.thread(await agy.agent());
  const reply = await agy.start(thread, 'think hello');
  await agy.events.finished(reply);
  const next = await agy.start(thread, 'again');
  await agy.events.finished(next);
  const log = await agy.logged('session/close', 2);
  expect(
    redact({
      events: agy.turnEvents(reply).map((event) => without(event, ['cursor', 'generationId', 'threadId'])),
      history: await agy.history(thread),
      usage: [usageOf(reply), usageOf(next)],
      methods: turnMethods(log),
      initialize: log.find((entry) => entry.method === 'initialize')?.params,
      sessionNew: log.find((entry) => entry.method === 'session/new' && JSON.stringify(entry.params).includes('/workspaces/'))?.params,
      prompts: log.filter((entry) => entry.method === 'session/prompt').map((entry) => entry.params),
    }),
  ).toMatchInlineSnapshot(`
    {
      "events": [
        {
          "kind": "generation.started",
          "state": "queued",
          "userMessage": {
            "attachments": [],
            "createdAt": "2026-01-01T00:00:03.000Z",
            "id": "id-4",
            "kind": "user",
            "text": "think hello",
            "threadId": "id-2",
          },
        },
        {
          "detail": null,
          "kind": "generation.status",
          "queueNote": null,
          "state": "running",
        },
        {
          "detail": "Thinking",
          "kind": "generation.status",
          "queueNote": null,
          "state": "running",
        },
        {
          "kind": "generation.delta",
          "text": "Echo: ",
        },
        {
          "kind": "generation.delta",
          "text": "think hello",
        },
        {
          "kind": "generation.finished",
          "message": {
            "attachments": [],
            "createdAt": "2026-01-01T00:00:05.000Z",
            "id": "id-5",
            "kind": "assistant",
            "outcome": {
              "finishReason": "stop",
              "kind": "completed",
            },
            "text": "Echo: think hello",
            "threadId": "id-2",
          },
        },
      ],
      "history": [
        "user: think hello",
        "assistant(completed): Echo: think hello",
        "user: again",
        "assistant(completed): Echo: again",
      ],
      "initialize": {
        "clientCapabilities": {
          "fs": {
            "readTextFile": false,
            "writeTextFile": false,
          },
          "terminal": false,
        },
        "clientInfo": {
          "name": "morrowbot",
          "title": "MorrowBot",
          "version": "0.1.0",
        },
        "protocolVersion": 1,
      },
      "methods": [
        "session/new",
        "session/set_config_option",
        "session/close",
        "session/new",
        "session/prompt",
        "session/close",
        "session/new",
        "session/prompt",
        "session/close",
      ],
      "prompts": [
        {
          "prompt": [
            {
              "text": "think hello",
              "type": "text",
            },
          ],
          "sessionId": "sess-<pid>-2",
        },
        {
          "prompt": [
            {
              "text": "Continue this conversation. Reply to the last user message.

    <conversation>
    <user>
    think hello
    </user>
    <assistant>
    Echo: think hello
    </assistant>
    <user>
    again
    </user>
    </conversation>",
              "type": "text",
            },
          ],
          "sessionId": "sess-<pid>-3",
        },
      ],
      "sessionNew": {
        "cwd": "$HOME/data/workspaces/id-1",
        "mcpServers": [],
      },
      "usage": [
        {
          "actual_model": "fake-pro",
          "cache_write_tokens": 0,
          "cached_input_tokens": 80,
          "input_tokens": 120,
          "output_tokens": 12,
          "reasoning_tokens": 3,
        },
        {
          "actual_model": "fake-pro",
          "cache_write_tokens": 0,
          "cached_input_tokens": 80,
          "input_tokens": 120,
          "output_tokens": 12,
          "reasoning_tokens": 3,
        },
      ],
    }
  `);
});

it('reports signed-out on the first provider-info when agy refuses the probe session for sign-in', async () => {
  await agy.setState({ signedOut: true });
  const info = await agy.host.call('GET', '/api/plugins/provider-antigravity/info');
  expect(redact({ info: info.body, methods: turnMethods(await agy.log()) })).toMatchInlineSnapshot(`
    {
      "info": {
        "info": {
          "kind": "signed-out",
          "signIn": {
            "argv": [
              "<fake-agy>",
              "acp",
              "--gemini-dir",
              "$HOME/data/plugin-data/provider-antigravity/gemini",
              "--login",
            ],
            "kind": "run-in-terminal",
          },
        },
      },
      "methods": [
        "session/new",
      ],
    }
  `);
});
