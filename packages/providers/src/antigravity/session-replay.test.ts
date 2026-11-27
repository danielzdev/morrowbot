import { readOptionalFile, z, type ApprovalAnswer, type TurnChunk } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { decide, permissionResult } from './permission.ts';
import { PermissionRequest, PromptResponse } from './protocol.ts';
import { createSessionStream, type Breach } from './session-stream.ts';
import { outcomeOf, usageOf } from './turn.ts';

/** Recorded from agy 1.5.18 in a folder `/work/ws2` with every permission denied; paths and ids redacted. */
async function fixture(name: string): Promise<string> {
  const text = await readOptionalFile(decodeURIComponent(new URL(`./fixtures/1.5.18/${name}`, import.meta.url).pathname), { maxBytes: 1_000_000 });
  if (text === null) throw new Error(`missing fixture ${name}`);
  return text;
}

const Message = z.looseObject({ id: z.unknown().optional(), method: z.string().optional(), params: z.looseObject({ update: z.unknown().optional() }).optional(), result: z.unknown().optional() });

/**
 * Replays one recorded prompt: each `session/update` through the stream, each permission request
 * through the read-only policy (answering Deny where a card would be shown), and the prompt's reply.
 */
async function replay(name: string): Promise<unknown> {
  const chunks: TurnChunk[] = [];
  const breaches: Breach[] = [];
  const permissions: unknown[] = [];
  let end: unknown = null;
  const stream = createSessionStream({ home: '/work', emit: (chunk) => chunks.push(chunk), onBreach: (breach) => breaches.push(breach) });
  const lines = (await fixture(name)).split('\n').filter((line) => line !== '');
  for (const line of lines) {
    const message = Message.parse(JSON.parse(line));
    if (message.method === 'session/update') stream.hear(message.params?.update);
    else if (message.method === 'session/request_permission') {
      const request = PermissionRequest.parse(message.params);
      const decision = decide(request, '/work');
      const answer: ApprovalAnswer | null = decision.kind === 'ask' ? { kind: 'chosen', choiceId: 'deny' } : null;
      permissions.push({ decision, reply: permissionResult(request.options, answer, false) });
    } else if (message.method === undefined) {
      const reply = PromptResponse.parse(message.result);
      end = { outcome: outcomeOf(reply.stopReason, false), usage: usageOf(reply) };
    }
  }
  return { chunks, permissions, breaches, end };
}

it('replays a real reply: two text chunks, no tools, and the token counts of the prompt', async () => {
  expect(await replay('hello.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "chunks": [
        {
          "kind": "text",
          "text": "KUMQUAT Hello, I hope you are having a wonderful day! PERSIMMON",
        },
      ],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": 0,
          "cachedInputTokens": 0,
          "inputTokens": 10563,
          "kind": "reported",
          "outputTokens": 18,
          "reasoningTokens": 0,
        },
      },
      "permissions": [],
    }
  `);
});

it('replays a real read inside the workspace: agy asks nothing and the read completes', async () => {
  expect(await replay('read-inside.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "chunks": [
        {
          "input": {
            "title": "File notes.txt",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "call_17517322681424555508",
        },
        {
          "kind": "tool-end",
          "outcome": "ok",
          "toolUseId": "call_17517322681424555508",
        },
        {
          "kind": "text",
          "text": "KUMQUAT

    The exact contents of [notes.txt](file:///work/ws2/notes.txt) are:

    \`\`\`
    hello inside
    \`\`\`

    PERSIMMON",
        },
      ],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": 0,
          "cachedInputTokens": 8529,
          "inputTokens": 12812,
          "kind": "reported",
          "outputTokens": 234,
          "reasoningTokens": 0,
        },
      },
      "permissions": [],
    }
  `);
});

it('replays a real command: agy asks, the policy denies it without a card, and the tool fails', async () => {
  expect(await replay('command-denied.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "chunks": [
        {
          "input": {
            "title": "touch ran.txt",
          },
          "kind": "tool-start",
          "name": "Shell",
          "toolUseId": "call_15939647238183441366",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_15939647238183441366",
        },
      ],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": 0,
          "cachedInputTokens": 0,
          "inputTokens": 10571,
          "kind": "reported",
          "outputTokens": 39,
          "reasoningTokens": 0,
        },
      },
      "permissions": [
        {
          "decision": {
            "kind": "deny",
            "status": "Denied execute touch ran.txt: MorrowBot runs Antigravity read-only.",
          },
          "reply": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
      ],
    }
  `);
});

it('replays a real write outside the workspace: denied without a card', async () => {
  expect(await replay('write-outside-denied.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "chunks": [
        {
          "input": {
            "title": "File ../outside/written.txt",
          },
          "kind": "tool-start",
          "name": "Edit",
          "toolUseId": "call_5171785024618745406",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_5171785024618745406",
        },
      ],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": 0,
          "cachedInputTokens": 0,
          "inputTokens": 10667,
          "kind": "reported",
          "outputTokens": 115,
          "reasoningTokens": 0,
        },
      },
      "permissions": [
        {
          "decision": {
            "kind": "deny",
            "status": "Denied edit ~/outside/written.txt: MorrowBot runs Antigravity read-only.",
          },
          "reply": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
      ],
    }
  `);
});

it('replays a real read through a symlink out of the workspace: it goes to a card, and Deny fails it', async () => {
  expect(await replay('read-outside-denied.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "chunks": [
        {
          "input": {
            "title": "File escape/secret.txt",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "call_5945185593953936374",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_5945185593953936374",
        },
      ],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": 0,
          "cachedInputTokens": 0,
          "inputTokens": 10563,
          "kind": "reported",
          "outputTokens": 112,
          "reasoningTokens": 0,
        },
      },
      "permissions": [
        {
          "decision": {
            "kind": "ask",
            "summary": "read ~/outside/secret.txt",
          },
          "reply": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
      ],
    }
  `);
});

it('replays a real turn of four tool calls: only the first asks, the rest fail without asking, nothing breaches', async () => {
  expect(await replay('four-tools-denied.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "chunks": [
        {
          "input": {
            "title": "File inside.txt",
          },
          "kind": "tool-start",
          "name": "Edit",
          "toolUseId": "call_5511699085252765712",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_5511699085252765712",
        },
        {
          "input": {
            "title": "File ../outside/written.txt",
          },
          "kind": "tool-start",
          "name": "Edit",
          "toolUseId": "call_5511699085252766207",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_5511699085252766207",
        },
        {
          "input": {
            "title": "touch ran.txt",
          },
          "kind": "tool-start",
          "name": "Shell",
          "toolUseId": "call_5511699085252766702",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_5511699085252766702",
        },
        {
          "input": {
            "title": "File escape/secret.txt",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "call_5511699085252767197",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "call_5511699085252767197",
        },
      ],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": 0,
          "cachedInputTokens": 0,
          "inputTokens": 10726,
          "kind": "reported",
          "outputTokens": 382,
          "reasoningTokens": 0,
        },
      },
      "permissions": [
        {
          "decision": {
            "kind": "deny",
            "status": "Denied edit ~/ws2/inside.txt: MorrowBot runs Antigravity read-only.",
          },
          "reply": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
      ],
    }
  `);
});
