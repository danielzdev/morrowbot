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

/** The `usage` of a real 2.1.332 `result` line, trimmed to the fields MorrowBot reads plus two it ignores. */
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
  const reader = createTurnReader({ home: HOME }, (chunk) => chunks.push(TurnChunk.parse(chunk)));
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
