import { describe, expect, it } from 'vitest';
import { parseCliLine } from './stream-json.ts';

const parse = (value: unknown) => parseCliLine(typeof value === 'string' ? value : JSON.stringify(value));

const textDelta = (text: string, parent: string | null = null) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  session_id: 's',
  parent_tool_use_id: parent,
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
      parse({ type: 'system', subtype: 'init', model: 'claude-haiku-5-5', tools: ['Read'], session_id: 's' }),
      parse({ type: 'system', subtype: 'status', status: 'requesting', session_id: 's' }),
      parse({
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        parent_tool_use_id: null,
      }),
      parse({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          model: 'claude-haiku-5-5',
          content: [
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: './note.txt' }, caller: { type: 'direct' } },
          ],
        },
      }),
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
          "kind": "chunks",
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
                "file_path": "./note.txt",
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

  it('reads the final result, including errors Claude Code reports as results', () => {
    expect([
      parse({ type: 'result', subtype: 'success', is_error: false, result: 'hi there', stop_reason: 'end_turn' }),
      parse({ type: 'result', subtype: 'success', is_error: false, result: 'cut off', stop_reason: 'max_tokens' }),
      parse({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Not logged in · Please run /login',
        terminal_reason: 'api_error',
        stop_reason: 'stop_sequence',
      }),
      parse({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['tool crashed', 'gave up'] }),
      parse({ type: 'result', subtype: 'error_max_turns', is_error: true }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "result",
          "result": {
            "finishReason": "stop",
            "kind": "success",
            "text": "hi there",
          },
        },
        {
          "kind": "result",
          "result": {
            "finishReason": "length",
            "kind": "success",
            "text": "cut off",
          },
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "Not logged in · Please run /login",
          },
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "tool crashed; gave up",
          },
        },
        {
          "kind": "result",
          "result": {
            "kind": "error",
            "message": "Claude Code stopped (error_max_turns)",
          },
        },
      ]
    `);
  });

  it('flags malformed lines and skips blank lines and unknown event types', () => {
    expect([
      parse('Warning: something printed to stdout'),
      parse('[1, 2]'),
      parse({ type: 'result', subtype: 'success' }),
      parse(''),
      parse({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
      parse({
        type: 'stream_event',
        event: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
        parent_tool_use_id: null,
      }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "malformed",
          "problem": "not JSON: Warning: something printed to stdout",
        },
        {
          "kind": "malformed",
          "problem": "a JSON value without a "type"",
        },
        {
          "kind": "malformed",
          "problem": "a "result" line with an unexpected shape (is_error: Invalid input: expected boolean, received undefined)",
        },
        {
          "kind": "skip",
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
