import { expect, it } from 'vitest';
import { buildInvocation } from './invocation.ts';

/** The invocation with its stdin frame read back, after checking the frame is one NDJSON line. */
function shown(invocation: ReturnType<typeof buildInvocation>) {
  const lines = invocation.frame.split('\n');
  expect(lines.length === 2 && lines[1] === '').toBe(true);
  const frame: unknown = JSON.parse(invocation.frame);
  return { ...invocation, frame };
}

it('runs read-only and isolated, with the model, system prompt file and seeded conversation', () => {
  expect(
    shown(buildInvocation({
      access: 'read-only',
      mode: 'interactive',
      selection: { kind: 'model', id: 'opus', choices: {} },
      system: 'Be brief.',
      seed: '<user>\nName a fish.\n</user>\n<assistant>\nKoi.\n</assistant>',
      prompt: 'Another?',
    })),
  ).toMatchInlineSnapshot(`
    {
      "args": [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--safe-mode",
        "--strict-mcp-config",
        "--restricted",
        "--tools",
        "Read,Glob,Grep",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--model",
        "opus",
        "--append-system-prompt-file",
        "/dev/fd/4",
      ],
      "files": [
        "Be brief.",
      ],
      "frame": {
        "message": {
          "content": "Continue this conversation. Reply to the last user message.

    <conversation>
    <user>
    Name a fish.
    </user>
    <assistant>
    Koi.
    </assistant>
    <user>
    Another?
    </user>
    </conversation>",
          "role": "user",
        },
        "type": "user",
      },
    }
  `);
});

it('sends an unseeded prompt as is, with no model or system flags', () => {
  expect(shown(buildInvocation({ access: 'read-only', mode: 'background', selection: { kind: 'default' }, system: null, seed: null, prompt: 'hi' }))).toMatchInlineSnapshot(`
    {
      "args": [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--safe-mode",
        "--strict-mcp-config",
        "--restricted",
        "--tools",
        "Read,Glob,Grep",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
      ],
      "files": [],
      "frame": {
        "message": {
          "content": "hi",
          "role": "user",
        },
        "type": "user",
      },
    }
  `);
});

it('lets workspace-write edit with the file tools only, asking the host interactively and nobody in the background', () => {
  const flags = (mode: 'interactive' | 'background') =>
    buildInvocation({ access: 'workspace-write', mode, selection: { kind: 'default' }, system: null, seed: null, prompt: 'hi' }).args.slice(10);
  expect({ interactive: flags('interactive'), background: flags('background') }).toMatchInlineSnapshot(`
    {
      "background": [
        "--restricted",
        "--tools",
        "Read,Glob,Grep,Edit,Write",
        "--permission-mode",
        "acceptEdits",
        "--permission-prompts",
        "none",
      ],
      "interactive": [
        "--restricted",
        "--tools",
        "Read,Glob,Grep,Edit,Write",
        "--permission-mode",
        "acceptEdits",
        "--permission-prompts",
        "host",
        "--permission-prompt-tool",
        "stdio",
      ],
    }
  `);
});
