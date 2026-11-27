import { acp, readOptionalFile, z, type ApprovalAnswer, type TurnChunk } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { BUILD_MODE } from './config.ts';
import { createModelCatalog } from './models.ts';
import { outcomeOf, usageOf } from './turn.ts';

/** Recorded from opencode 2.4.1 under MorrowBot's read-only config in a folder `/work/ws`; paths and ids redacted. */
async function fixture(name: string): Promise<string> {
  const text = await readOptionalFile(decodeURIComponent(new URL(`./fixtures/2.4.1/${name}`, import.meta.url).pathname), { maxBytes: 1_000_000 });
  if (text === null) throw new Error(`missing fixture ${name}`);
  return text;
}

const Message = z.looseObject({ method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional() });

/**
 * Replays one recorded prompt: each `session/update` through the stream and the tripwire, each
 * permission request through the read-only policy (answering Deny where a card would be shown),
 * and the prompt's reply.
 */
async function replay(name: string): Promise<unknown> {
  const chunks: TurnChunk[] = [];
  const breaches: acp.Breach[] = [];
  const permissions: unknown[] = [];
  let denied = false;
  let end: unknown = null;
  const stream = acp.createSessionStream({ home: '/work', mode: BUILD_MODE, emit: (chunk) => chunks.push(chunk), onBreach: (breach) => breaches.push(breach) });
  const tripwire = acp.createTripwire('/work', (breach) => breaches.push(breach));
  for (const line of (await fixture(name)).split('\n').filter((each) => each !== '')) {
    const message = Message.parse(JSON.parse(line));
    if (message.method === 'session/update') {
      const { sessionId, update } = acp.SessionNotification.parse(message.params);
      tripwire.hear(sessionId, update);
      stream.hear(update);
    } else if (message.method === 'session/request_permission') {
      const request = acp.PermissionRequest.parse(message.params);
      const decision = acp.decide(request, '/work', 'OpenCode');
      const answer: ApprovalAnswer | null = decision.kind === 'ask' ? { kind: 'chosen', choiceId: 'deny' } : null;
      denied = true;
      permissions.push({ decision, reply: acp.permissionResult(request.options, answer, false) });
    } else if (message.method === undefined) {
      const reply = acp.PromptResponse.parse(message.result);
      end = { outcome: outcomeOf(reply.stopReason, { stopped: false, denied }), usage: usageOf(reply) };
    }
  }
  const text = chunks.flatMap((chunk) => (chunk.kind === 'text' ? [chunk.text] : [])).join('');
  return { text, other: chunks.filter((chunk) => chunk.kind !== 'text'), permissions, breaches, end };
}

it('lists the free models from a real session/new, without the provider prefix opencode puts on each name', async () => {
  const created = acp.SessionNewResponse.parse(z.looseObject({ result: z.unknown() }).parse(JSON.parse(await fixture('session-new.json'))).result);
  expect({ models: createModelCatalog().observe(created.configOptions ?? [], true)?.map((model) => `${model.id} "${model.label}"${model.isDefault ? ' default' : ''}`), mode: acp.selectOf(created.configOptions ?? [], 'mode') }).toMatchInlineSnapshot(`
    {
      "mode": {
        "current": "build",
        "values": [
          {
            "description": "The default agent. Executes tools based on configured permissions.",
            "name": "Build",
            "value": "build",
          },
        ],
      },
      "models": [
        "opencode/beam-free "Beam Free"",
        "opencode/big-pickle "Big Pickle" default",
        "opencode/deepseek-v4.1-flash-free "DeepSeek V4.1 Flash Free"",
        "opencode/flint-40b-free "Flint 40B Free"",
        "opencode/hy4-flash-free "Hy4 flash Free"",
        "opencode/iceman-free "Iceman Free"",
        "opencode/mimo-v2.6-flash-free "MiMo-V2.6-Flash Free"",
        "opencode/nemotron-3.5-lightning-free "Nemotron 3.5 Lightning Free"",
        "opencode/nemotron-3.5-super-vl-free "Nemotron 3.5 Super VL Free"",
        "opencode/seaglass-alpha-free "Seaglass Alpha Free"",
        "opencode/tidepool-alpha-free "Tidepool Alpha Free"",
      ],
    }
  `);
});

it('replays a real reply: text, no tools, and the token counts of the prompt', async () => {
  expect(await replay('hello.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": null,
          "cachedInputTokens": 512,
          "inputTokens": 1154,
          "kind": "reported",
          "outputTokens": 7,
          "reasoningTokens": 10,
        },
      },
      "other": [
        {
          "kind": "status",
          "text": "Thinking",
        },
      ],
      "permissions": [],
      "text": "Hello from OpenCode.",
    }
  `);
});

it('replays a real read inside the workspace: allowed by the config, so no permission request', async () => {
  expect(await replay('read-inside.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": null,
          "cachedInputTokens": 1536,
          "inputTokens": 1854,
          "kind": "reported",
          "outputTokens": 26,
          "reasoningTokens": 9,
        },
      },
      "other": [
        {
          "kind": "status",
          "text": "Thinking",
        },
        {
          "input": {
            "title": "read",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "chatcmpl-tool-975fdd35c753c50c",
        },
        {
          "kind": "tool-end",
          "outcome": "ok",
          "toolUseId": "chatcmpl-tool-975fdd35c753c50c",
        },
      ],
      "permissions": [],
      "text": "The secret fruit is **KUMQUAT**.",
    }
  `);
});

it('replays a real read outside the workspace: a card (answered Deny), then opencode ends the prompt as cancelled, a completed reply', async () => {
  expect(await replay('read-outside-denied.jsonl')).toMatchInlineSnapshot(`
    {
      "breaches": [],
      "end": {
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "usage": {
          "cacheWriteTokens": null,
          "cachedInputTokens": 512,
          "inputTokens": 1159,
          "kind": "reported",
          "outputTokens": 21,
          "reasoningTokens": 22,
        },
      },
      "other": [
        {
          "kind": "status",
          "text": "Thinking",
        },
        {
          "input": {
            "title": "read",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "chatcmpl-tool-a601cfd94e858543",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "chatcmpl-tool-a601cfd94e858543",
        },
      ],
      "permissions": [
        {
          "decision": {
            "kind": "ask",
            "summary": "read /etc/hosts",
          },
          "reply": {
            "outcome": {
              "optionId": "reject",
              "outcome": "selected",
            },
          },
        },
      ],
      "text": "",
    }
  `);
});

it('replays a real request to write a file and run a command: opencode is offered neither tool, so it only answers in text', async () => {
  const replayed = await replay('write-and-shell-not-offered.jsonl');
  expect(replayed).toMatchObject({ other: [{ kind: 'status', text: 'Thinking' }], permissions: [], breaches: [], end: { outcome: { kind: 'completed', finishReason: 'stop' } } });
});
