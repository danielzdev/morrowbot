import { expect, it } from 'vitest';
import { buildInvocation } from './invocation.ts';

const settings = { model: 'opus', cliPath: 'claude' };

it('passes the model and system prompt as flags and the conversation on stdin', () => {
  expect(
    buildInvocation(
      {
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Name a fish.' },
          { role: 'assistant', content: 'Koi.' },
          { role: 'user', content: 'Another?' },
        ],
      },
      settings,
    ),
  ).toMatchInlineSnapshot(`
    {
      "args": [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--model",
        "opus",
        "--append-system-prompt",
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

it('sends a single message as is and refuses a conversation that does not end with the user', () => {
  const single = buildInvocation({ messages: [{ role: 'user', content: 'hi' }] }, { ...settings, model: 'default' });
  const refused = (() => {
    try {
      return buildInvocation({ messages: [{ role: 'assistant', content: 'hi' }] }, settings);
    } catch (error) {
      return String(error);
    }
  })();
  expect({ single, refused }).toMatchInlineSnapshot(`
    {
      "refused": "Error: The last message must come from the user",
      "single": {
        "args": [
          "--print",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--no-session-persistence",
        ],
        "input": "hi",
      },
    }
  `);
});
