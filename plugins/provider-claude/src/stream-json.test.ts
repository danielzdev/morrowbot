import { describe, expect, it } from 'vitest';
import { parseCliLine } from './stream-json.ts';

const HOME = '/Users/tester';
const json = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
const parse = (value: unknown) => parseCliLine(json(value), { home: HOME });

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

describe('parseCliLine', () => {
  it('turns top-level text deltas into text chunks and drops subagent text', () => {
    expect([parse(textDelta('hi there')), parse(textDelta('inside a subagent', 'toolu_1'))]).toMatchInlineSnapshot(`
      [
        {
          "chunks": [
            {
              "kind": "text",
              "text": "hi there",
            },
          ],
          "kind": "chunks",
        },
        {
          "kind": "skip",
        },
      ]
    `);
  });

  it('reports the model, thinking, and tool calls as status and tool events', () => {
    expect([
      parse(init),
      parse({ type: 'system', subtype: 'status', status: 'requesting', session_id: 's' }),
      parse({
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        parent_tool_use_id: null,
      }),
      parse(toolUse('toolu_01', { file_path: `${HOME}/work/note.txt`, other: [HOME, '/elsewhere'] })),
      parse({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', content: 'File does not exist.', is_error: true, tool_use_id: 'toolu_01' },
            { tool_use_id: 'toolu_02', type: 'tool_result', content: '1\tsecret word: koi\n' },
          ],
        },
      }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "chunks": [
            {
              "kind": "status",
              "text": "Started claude-haiku-5-5",
            },
          ],
          "kind": "init",
          "model": "claude-haiku-5-5",
        },
        {
          "kind": "skip",
        },
        {
          "chunks": [
            {
              "kind": "status",
              "text": "Thinking",
            },
          ],
          "kind": "chunks",
        },
        {
          "chunks": [
            {
              "input": {
                "file_path": "~/work/note.txt",
                "other": [
                  "~",
                  "/elsewhere",
                ],
              },
              "kind": "tool-start",
              "name": "Read",
              "toolUseId": "toolu_01",
            },
          ],
          "kind": "chunks",
        },
        {
          "chunks": [
            {
              "kind": "tool-end",
              "outcome": "error",
              "toolUseId": "toolu_01",
            },
            {
              "kind": "tool-end",
              "outcome": "ok",
              "toolUseId": "toolu_02",
            },
          ],
          "kind": "chunks",
        },
      ]
    `);
  });

  it('shortens tool input over 4 KB to the start of its JSON', () => {
    const parsed = parse(toolUse('toolu_big', { pattern: 'x"'.repeat(3000) }));
    const input = parsed.kind === 'chunks' && parsed.chunks[0]?.kind === 'tool-start' ? parsed.chunks[0].input : null;
    expect({ type: typeof input, jsonLength: JSON.stringify(input).length, start: typeof input === 'string' ? input.slice(0, 20) : null }).toMatchInlineSnapshot(`
      {
        "jsonLength": 3838,
        "start": "{"pattern":"x\\"x\\"x\\",
        "type": "string",
      }
    `);
  });

  it('reads the final result with its token usage, including errors Claude Code reports as results', () => {
    expect([
      parse(success('hi there')),
      parse({ type: 'result', subtype: 'success', is_error: false, result: 'cut off', stop_reason: 'max_tokens' }),
      parse({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['tool crashed', 'gave up'] }),
      parse({ type: 'result', subtype: 'error_max_turns', is_error: true }),
      parse({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '', errors: ['', 'rate limited'] }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "result",
          "result": {
            "finishReason": "stop",
            "kind": "success",
            "text": "hi there",
            "usage": {
              "cacheWriteTokens": 3083,
              "cachedInputTokens": 9355,
              "inputTokens": 4,
              "kind": "reported",
              "outputTokens": 395,
              "reasoningTokens": null,
            },
          },
        },
        {
          "kind": "result",
          "result": {
            "finishReason": "length",
            "kind": "success",
            "text": "cut off",
            "usage": {
              "kind": "unavailable",
            },
          },
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "tool crashed; gave up",
            "usage": {
              "kind": "unavailable",
            },
          },
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "Claude Code stopped (error_max_turns)",
            "usage": {
              "kind": "unavailable",
            },
          },
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "rate limited",
            "usage": {
              "kind": "unavailable",
            },
          },
        },
      ]
    `);
  });

  it('flags malformed lines, skips blank lines and unknown event types, and ends on a result it cannot read', () => {
    expect([
      parse('Warning: something printed to stdout'),
      parse('[1, 2]'),
      parse({ type: 'result', subtype: 'success' }),
      parse(''),
      parse({
        type: 'stream_event',
        event: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
        parent_tool_use_id: null,
      }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "malformed",
          "problem": "a 36-character line that is not JSON",
        },
        {
          "kind": "malformed",
          "problem": "a JSON value without a "type"",
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "Claude Code ended with a "result" line with an unexpected shape (is_error: Invalid input: expected boolean, received undefined)",
            "usage": {
              "kind": "unavailable",
            },
          },
        },
        {
          "kind": "skip",
        },
        {
          "kind": "skip",
        },
      ]
    `);
  });
});
