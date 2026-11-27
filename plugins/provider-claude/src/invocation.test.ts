import { expect, it } from 'vitest';
import { buildInvocation } from './invocation.ts';

it('runs read-only and isolated, with the model, system prompt file and seeded conversation', () => {
  expect(
    buildInvocation({
      selection: { kind: 'model', id: 'opus', choices: {} },
      system: 'Be brief.',
      seed: '<user>\nName a fish.\n</user>\n<assistant>\nKoi.\n</assistant>',
      prompt: 'Another?',
    }),
  ).toMatchInlineSnapshot(`
    {
      "args": [
        "-p",
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
      "input": "Continue this conversation. Reply to the last user message.

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
    }
  `);
});

it('sends an unseeded prompt as is, with no model or system flags', () => {
  expect(buildInvocation({ selection: { kind: 'default' }, system: null, seed: null, prompt: 'hi' })).toMatchInlineSnapshot(`
    {
      "args": [
        "-p",
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
      "input": "hi",
    }
  `);
});
