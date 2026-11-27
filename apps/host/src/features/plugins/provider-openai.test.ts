import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SendMessageResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startCodexFixture, turnMethods, type CodexFixture } from '../../testing/codex-fixture.ts';

let codex: CodexFixture;

beforeEach(async () => {
  codex = await startCodexFixture();
});

afterEach(async () => {
  await codex.close();
  expect(codex.host.errors).toEqual([]);
});

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(codex.home, '$HOME').replace(/\b[0-9a-f]{64}\b/g, '<sha256>').replace(/turn-\d+-/g, 'turn-<pid>-'));
}

function without(event: object, keys: readonly string[]): unknown {
  return Object.fromEntries(Object.entries(event).filter(([key]) => !keys.includes(key)));
}

function usageOf(generationId: string): unknown {
  const db = new DatabaseSync(path.join(codex.home, 'data', 'morrowbot.sqlite'), { readOnly: true });
  const row = db
    .prepare('SELECT actual_model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens FROM turn_usage WHERE generation_id = ?')
    .get(generationId);
  db.close();
  return row;
}

async function sendAndWait(thread: { readonly id: string }, text: string): Promise<string> {
  const reply = await codex.post(thread, text);
  const { generationId } = SendMessageResponse.parse(reply.body);
  await codex.events.finished(generationId);
  return generationId;
}

it('reports Codex ready with its read-only profile and why the others are held back, starting the daemon through provider-info', async () => {
  const before = codex.daemonPgids().length;
  const info = await codex.host.call('GET', '/api/plugins/provider-openai/info');
  expect({ before, after: codex.daemonPgids().length, info: redact(info.body) }).toMatchInlineSnapshot(`
    {
      "after": 1,
      "before": 0,
      "info": {
        "info": {
          "accountKey": "<sha256>",
          "accountLabel": "ChatGPT Pro",
          "capabilities": {
            "approvals": false,
            "profiles": [
              {
                "access": "read-only",
                "modes": [
                  "interactive",
                  "background",
                ],
                "readsOutsideCwd": true,
                "vendorSettings": "personal",
              },
            ],
            "sessions": true,
            "usage": "live",
            "withheld": [
              {
                "access": "workspace-write",
                "reason": "Codex runs each shell command in its own process group, and a command that calls setsid keeps running after Stop (checked on Codex 0.171). Workspace-write needs Stop to end every command.",
                "vendorSettings": "personal",
              },
              {
                "access": "read-only",
                "reason": "Codex always loads your own ~/.codex/AGENTS.md (checked on Codex 0.171), so MorrowBot cannot replace its instructions. Use your Codex instructions instead.",
                "vendorSettings": "isolated",
              },
              {
                "access": "workspace-write",
                "reason": "Codex always loads your own ~/.codex/AGENTS.md (checked on Codex 0.171), so MorrowBot cannot replace its instructions. Use your Codex instructions instead.",
                "vendorSettings": "isolated",
              },
            ],
          },
          "kind": "ready",
          "models": [
            {
              "id": "gpt-test",
              "isDefault": true,
              "label": "GPT Test",
              "options": [
                {
                  "choices": [
                    {
                      "id": "low",
                      "label": "Low",
                    },
                    {
                      "id": "high",
                      "label": "High",
                    },
                  ],
                  "defaultChoiceId": "low",
                  "id": "reasoningEffort",
                  "label": "Reasoning",
                },
              ],
            },
          ],
          "version": "0.171.0",
          "warning": null,
        },
      },
    }
  `);
});

it('streams a new thread, binds it to the account, counts its tokens, then reuses the loaded thread for the next turn', async () => {
  const thread = await codex.thread(await codex.agent());
  const first = await sendAndWait(thread, 'hello');
  const second = await sendAndWait(thread, 'tool please');
  const started = (await codex.log()).find((entry) => entry.method === 'thread/start');
  const turnStarts = (await codex.log()).filter((entry) => entry.method === 'turn/start').map((entry) => entry.params);
  expect(
    redact({
      events: codex.turnEvents(first).map((event) => without(event, ['cursor', 'generationId', 'threadId'])),
      toolEvents: codex
        .turnEvents(second)
        .filter((event) => event.kind === 'generation.tool-start' || event.kind === 'generation.tool-end')
        .map((event) => without(event, ['cursor'])),
      history: await codex.history(thread),
      usage: [usageOf(first), usageOf(second)],
      methods: turnMethods(await codex.log()),
      threadStart: started?.params,
      turnStarts,
    }),
  ).toMatchInlineSnapshot(`
    {
      "events": [
        {
          "kind": "generation.started",
          "state": "queued",
          "userMessage": {
            "createdAt": "2026-01-01T00:00:03.000Z",
            "id": "id-4",
            "kind": "user",
            "text": "hello",
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
          "text": "hello",
        },
        {
          "kind": "generation.finished",
          "message": {
            "createdAt": "2026-01-01T00:00:05.000Z",
            "id": "id-5",
            "kind": "assistant",
            "outcome": {
              "finishReason": "stop",
              "kind": "completed",
            },
            "text": "Echo: hello",
            "threadId": "id-2",
          },
        },
      ],
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: tool please",
        "assistant(completed): Echo: tool please",
      ],
      "methods": [
        "thread/start",
        "turn/start",
        "turn/start",
      ],
      "threadStart": {
        "approvalPolicy": "never",
        "config": {
          "features.apps": false,
          "features.browser_use": false,
          "features.browser_use_external": false,
          "features.code_mode_host": false,
          "features.computer_use": false,
          "features.hooks": false,
          "features.image_generation": false,
          "features.in_app_browser": false,
          "features.multi_agent": false,
          "features.multi_agent_v2": false,
          "features.plugins": false,
          "features.shell_snapshot": false,
          "features.shell_tool": false,
          "features.skill_mcp_dependency_install": false,
          "features.unified_exec": false,
          "mcp_servers.node_repl.enabled": false,
        },
        "cwd": "$HOME/data/workspaces/id-1",
        "ephemeral": false,
        "modelProvider": "openai",
        "sandbox": "read-only",
      },
      "toolEvents": [
        {
          "generationId": "id-6",
          "input": {
            "command": "cat ~/notes.txt API_TOKEN=***",
          },
          "kind": "generation.tool-start",
          "name": "Shell",
          "threadId": "id-2",
          "toolUseId": "turn-<pid>-2-c",
        },
        {
          "generationId": "id-6",
          "kind": "generation.tool-end",
          "outcome": "ok",
          "threadId": "id-2",
          "toolUseId": "turn-<pid>-2-c",
        },
      ],
      "turnStarts": [
        {
          "approvalPolicy": "never",
          "input": [
            {
              "text": "hello",
              "text_elements": [],
              "type": "text",
            },
          ],
          "sandboxPolicy": {
            "networkAccess": false,
            "type": "readOnly",
          },
          "threadId": "thread-1",
        },
        {
          "approvalPolicy": "never",
          "input": [
            {
              "text": "tool please",
              "text_elements": [],
              "type": "text",
            },
          ],
          "sandboxPolicy": {
            "networkAccess": false,
            "type": "readOnly",
          },
          "threadId": "thread-1",
        },
      ],
      "usage": [
        {
          "actual_model": "gpt-test",
          "cache_write_tokens": 0,
          "cached_input_tokens": 60,
          "input_tokens": 40,
          "output_tokens": 10,
          "reasoning_tokens": 4,
        },
        {
          "actual_model": "gpt-test",
          "cache_write_tokens": 0,
          "cached_input_tokens": 120,
          "input_tokens": 80,
          "output_tokens": 20,
          "reasoning_tokens": 8,
        },
      ],
    }
  `);
});
