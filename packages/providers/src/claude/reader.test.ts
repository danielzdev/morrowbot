import { TurnChunk, TurnEnd } from '@morrowbot/contracts';
import type { CommandExit } from '@morrowbot/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { createTurnReader } from './reader.ts';

const HOME = '/Users/tester';
const json = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

const textDelta = (text: string, parent: string | null = null) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  session_id: 's',
  parent_tool_use_id: parent,
});

const init = { type: 'system', subtype: 'init', model: 'claude-haiku-5-5', tools: ['Glob', 'Grep', 'Read'], session_id: 's' };

const toolUse = (id: string, input: unknown) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_use', id, name: 'Read', input, caller: { type: 'direct' } }] },
});

const toolResult = (id: string) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: '1\tsecret word: koi\n' }] },
});

/** The `usage` of a real 2.1.332 `result` line, trimmed to the fields Ori Bot reads plus two it ignores. */
const usage = {
  input_tokens: 4,
  cache_creation_input_tokens: 3083,
  cache_read_input_tokens: 9355,
  output_tokens: 395,
  output_tokens_details: { thinking_tokens: 155 },
  service_tier: 'standard',
};

const success = (result: string) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
  stop_reason: 'end_turn',
  usage,
  session_id: 's',
});

const EXITED: CommandExit = { kind: 'exited', code: 0, signal: null, stderr: '' };

/** Feeds lines to the turn reader as the CLI would print them and returns what reaches the host, checked against the contract. */
function replay(lines: readonly unknown[], exit: CommandExit = EXITED, cancelled = false) {
  const chunks: TurnChunk[] = [];
  const reader = createTurnReader(
    { home: HOME },
    {
      emit: (chunk) => chunks.push(TurnChunk.parse(chunk)),
      usage: () => undefined,
      control: () => undefined,
      done: () => undefined,
    },
  );
  for (const line of lines) reader.read(json(line));
  return { chunks, end: TurnEnd.parse(reader.finish(exit, { cliPath: 'claude', accountKey: 'key', cancelled })) };
}

describe('turn reader', () => {
  it('streams every text segment around a tool call when the result holds only the last one', () => {
    expect(
      replay([
        init,
        textDelta('Let me look. '),
        toolUse('toolu_01', { file_path: `${HOME}/work/note.txt` }),
        toolResult('toolu_01'),
        textDelta('The word is koi.'),
        success('The word is koi.'),
        textDelta('printed after the result'),
      ]),
    ).toMatchInlineSnapshot(`
      {
        "chunks": [
          {
            "kind": "status",
            "text": "Started claude-haiku-5-5",
          },
          {
            "kind": "text",
            "text": "Let me look. ",
          },
          {
            "input": {
              "file_path": "~/work/note.txt",
            },
            "kind": "tool-start",
            "name": "Read",
            "toolUseId": "toolu_01",
          },
          {
            "kind": "tool-end",
            "outcome": "ok",
            "toolUseId": "toolu_01",
          },
          {
            "kind": "text",
            "text": "The word is koi.",
          },
        ],
        "end": {
          "accountKey": "key",
          "actualModel": "claude-haiku-5-5",
          "finalText": "The word is koi.",
          "outcome": {
            "finishReason": "stop",
            "kind": "completed",
          },
          "sessionTouched": true,
          "usage": {
            "cacheWriteTokens": 3083,
            "cachedInputTokens": 9355,
            "inputTokens": 4,
            "kind": "reported",
            "outputTokens": 395,
            "reasoningTokens": null,
          },
        },
      }
    `);
  });

  it('keeps the result text as finalText when nothing was streamed', () => {
    expect(replay([init, success('Hello')]).end).toMatchInlineSnapshot(`
      {
        "accountKey": "key",
        "actualModel": "claude-haiku-5-5",
        "finalText": "Hello",
        "outcome": {
          "finishReason": "stop",
          "kind": "completed",
        },
        "sessionTouched": true,
        "usage": {
          "cacheWriteTokens": 3083,
          "cachedInputTokens": 9355,
          "inputTokens": 4,
          "kind": "reported",
          "outputTokens": 395,
          "reasoningTokens": null,
        },
      }
    `);
  });

  it('maps error results, early exits and Stop onto turn outcomes', () => {
    const error = (result: string) => ({ type: 'result', subtype: 'success', is_error: true, result });
    const outcome = (lines: readonly unknown[], exit?: CommandExit, cancelled?: boolean) => {
      const { end } = replay(lines, exit, cancelled);
      return { outcome: end.outcome, sessionTouched: end.sessionTouched, usage: end.usage.kind };
    };
    expect({
      signedOut: outcome([error('Not logged in · Please run /login')]),
      expired: outcome([error('API Error: 401 {"type":"error","error":{"type":"authentication_error"}}')]),
      rateLimited: outcome([error("You've hit your limit · resets 3pm")]),
      other: outcome([error('Something else broke')]),
      notInstalled: outcome([], { kind: 'not-found' }),
      crashed: outcome([init], { kind: 'exited', code: 2, signal: null, stderr: 'fake claude: boom\n' }),
      stopped: outcome([init, textDelta('Hel')], { kind: 'exited', code: null, signal: 'SIGTERM', stderr: '' }, true),
    }).toMatchInlineSnapshot(`
      {
        "crashed": {
          "outcome": {
            "error": {
              "kind": "other",
              "message": "Claude Code exited with code 2 before it replied: fake claude: boom",
            },
            "kind": "failed",
          },
          "sessionTouched": true,
          "usage": "unavailable",
        },
        "expired": {
          "outcome": {
            "error": {
              "kind": "signed-out",
            },
            "kind": "failed",
          },
          "sessionTouched": true,
          "usage": "unavailable",
        },
        "notInstalled": {
          "outcome": {
            "error": {
              "kind": "not-installed",
            },
            "kind": "failed",
          },
          "sessionTouched": false,
          "usage": "unavailable",
        },
        "other": {
          "outcome": {
            "error": {
              "kind": "other",
              "message": "Something else broke",
            },
            "kind": "failed",
          },
          "sessionTouched": true,
          "usage": "unavailable",
        },
        "rateLimited": {
          "outcome": {
            "error": {
              "kind": "rate-limited",
              "resetsAt": null,
              "windowId": null,
            },
            "kind": "failed",
          },
          "sessionTouched": true,
          "usage": "unavailable",
        },
        "signedOut": {
          "outcome": {
            "error": {
              "kind": "signed-out",
            },
            "kind": "failed",
          },
          "sessionTouched": true,
          "usage": "unavailable",
        },
        "stopped": {
          "outcome": {
            "kind": "cancelled",
          },
          "sessionTouched": true,
          "usage": "unavailable",
        },
      }
    `);
  });
});

/** A steer's stdin frame echoed back by `--replay-user-messages`, as 2.1.332 prints it. */
const echo = (uuid: string, text: string) => ({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: 's', uuid, isReplay: true });

/** Like `replay`, with one steer written (as `uuid` u-1) once `steerAt` lines have been read. */
function replaySteer(lines: readonly unknown[], steerAt: number) {
  const chunks: TurnChunk[] = [];
  let closed = false;
  const reader = createTurnReader(
    { home: HOME },
    {
      emit: (chunk) => chunks.push(TurnChunk.parse(chunk)),
      usage: () => undefined,
      control: () => undefined,
      done: () => {
        closed = true;
      },
    },
  );
  const taken: boolean[] = [];
  lines.forEach((line, index) => {
    if (index === steerAt) taken.push(reader.expect('u-1', 'steer-1'));
    reader.read(json(line));
  });
  taken.push(reader.expect('u-2', 'steer-2'));
  const end = TurnEnd.parse(reader.finish(EXITED, { cliPath: 'claude', accountKey: 'key', cancelled: false }));
  return { taken, closed, chunks: chunks.map((chunk) => (chunk.kind === 'text' ? chunk.text : chunk.kind === 'steer-delivered' ? `delivered ${chunk.steerId}` : chunk.kind)), end: { finalText: end.finalText, usage: end.usage } };
}

describe('steers', () => {
  it('delivers a steer Claude Code takes at a tool result, and ends at the one result', () => {
    expect(
      replaySteer([init, toolUse('toolu_01', {}), toolResult('toolu_01'), echo('u-1', 'what is 2+2?'), textDelta('4. Carrying on.'), success('4. Carrying on.')], 2),
    ).toMatchInlineSnapshot(`
      {
        "chunks": [
          "status",
          "tool-start",
          "tool-end",
          "delivered steer-1",
          "4. Carrying on.",
        ],
        "closed": true,
        "end": {
          "finalText": "4. Carrying on.",
          "usage": {
            "cacheWriteTokens": 3083,
            "cachedInputTokens": 9355,
            "inputTokens": 4,
            "kind": "reported",
            "outputTokens": 395,
            "reasoningTokens": null,
          },
        },
        "taken": [
          true,
          false,
        ],
      }
    `);
  });

  it('keeps the turn open past a result while a steer is not echoed, then ends at the reply to it, adding both usages', () => {
    expect(
      replaySteer([init, textDelta('A story.'), success('A story.'), init, echo('u-1', 'make it a cat'), textDelta(' Now with a cat.'), success('Now with a cat.')], 1),
    ).toMatchInlineSnapshot(`
      {
        "chunks": [
          "status",
          "A story.",
          "status",
          "delivered steer-1",
          " Now with a cat.",
        ],
        "closed": true,
        "end": {
          "finalText": "Now with a cat.",
          "usage": {
            "cacheWriteTokens": 6166,
            "cachedInputTokens": 18710,
            "inputTokens": 8,
            "kind": "reported",
            "outputTokens": 790,
            "reasoningTokens": null,
          },
        },
        "taken": [
          true,
          false,
        ],
      }
    `);
  });
});
