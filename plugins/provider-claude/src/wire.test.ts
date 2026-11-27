import { TurnChunk, TurnEnd } from '@morrowbot/contracts';
import { readOptionalFile, type ApprovalAnswer, type ApprovalAsk } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { createTurnWire } from './wire.ts';

const HOME = '/Users/tester';

/** A redacted transcript of a real Claude Code 2.1.332 turn, one stdout line each. */
async function transcript(name: string): Promise<string[]> {
  const path = decodeURIComponent(new URL(`../fixtures/2.1.332/${name}.jsonl`, import.meta.url).pathname);
  const text = await readOptionalFile(path, { maxBytes: 1_000_000 });
  if (text === null) throw new Error(`missing fixture ${name}`);
  return text.split('\n').filter((line) => line !== '');
}

/**
 * Replays a transcript through one turn's wire, answering any approval with `choice`, and returns
 * what the host and the CLI would see, in order: chunks (checked against the contract, text joined),
 * cards, stdin lines and the stdin close.
 */
async function replay(name: string, options: { readonly asks: boolean; readonly choice?: ApprovalAnswer }) {
  const log: unknown[] = [];
  let text = '';
  const flushText = () => {
    if (text !== '') log.push({ text });
    text = '';
  };
  const wire = createTurnWire({
    home: HOME,
    accountKey: 'key',
    asks: options.asks,
    ask: (request: ApprovalAsk) => {
      flushText();
      log.push({ card: request.summary, choices: request.choices.map((choice) => choice.id) });
      return Promise.resolve(options.choice ?? { kind: 'refused', reason: 'turn-ended' });
    },
    emit: (raw) => {
      const chunk = TurnChunk.parse(raw);
      if (chunk.kind === 'text') {
        text += chunk.text;
        return;
      }
      flushText();
      log.push(chunk.kind === 'usage-update' ? { usage: chunk.windows.map(({ id, usedPercent, resetsAt }) => ({ id, usedPercent, resetsAt })) } : chunk);
    },
    onUsage: () => undefined,
    write: (line) => {
      flushText();
      const written: unknown = JSON.parse(line);
      log.push({ stdin: written });
    },
    end: () => {
      flushText();
      log.push('stdin closed');
    },
  });
  for (const line of await transcript(name)) {
    wire.read(line);
    await Promise.resolve();
  }
  flushText();
  const end = TurnEnd.parse(wire.finish({ kind: 'exited', code: 0, signal: null, stderr: '' }, { cliPath: 'claude', accountKey: 'key', cancelled: false }));
  return { log: log.filter((entry) => !(typeof entry === 'object' && entry !== null && 'kind' in entry && entry.kind === 'status')), outcome: end.outcome };
}

const ALLOW: ApprovalAnswer = { kind: 'chosen', choiceId: 'allow' };
const DENY: ApprovalAnswer = { kind: 'chosen', choiceId: 'deny' };

it('asks before an interactive workspace-write turn writes .git/x, and allows it with the original input', async () => {
  expect(await replay('write-git-allow', { asks: true, choice: ALLOW })).toMatchInlineSnapshot(`
    {
      "log": [
        {
          "usage": [
            {
              "id": "five_hour",
              "resetsAt": "2026-11-27T14:10:00.000Z",
              "usedPercent": 10,
            },
            {
              "id": "seven_day",
              "resetsAt": "2026-11-28T06:00:00.000Z",
              "usedPercent": 24,
            },
          ],
        },
        {
          "input": {
            "content": "hi",
            "file_path": "~/work/.git/x",
          },
          "kind": "tool-start",
          "name": "Write",
          "toolUseId": "toolu_01JZtNfdtDvX6Qu2TkbXwGDX",
        },
        {
          "card": "Write .git/x: Claude requested permissions to edit ~/work/.git/x which is a sensitive file.",
          "choices": [
            "allow",
            "deny",
          ],
        },
        {
          "stdin": {
            "response": {
              "request_id": "00000000-0000-0000-0000-000000000000",
              "response": {
                "behavior": "allow",
                "updatedInput": {
                  "content": "hi",
                  "file_path": "/Users/tester/work/.git/x",
                },
              },
              "subtype": "success",
            },
            "type": "control_response",
          },
        },
        {
          "kind": "tool-end",
          "outcome": "ok",
          "toolUseId": "toolu_01JZtNfdtDvX6Qu2TkbXwGDX",
        },
        {
          "text": "I created the file \`.git/x\` containing \`hi\`, at \`/Users/tester/work/.git/x\`. I didn't run anything else.",
        },
        "stdin closed",
      ],
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
    }
  `);
});

it('denies the .git/x write when the user chooses Deny', async () => {
  const { log, outcome } = await replay('write-git-deny', { asks: true, choice: DENY });
  expect({ answers: log.filter((entry) => typeof entry === 'object' && entry !== null && ('card' in entry || 'stdin' in entry)), outcome }).toMatchInlineSnapshot(`
    {
      "answers": [
        {
          "card": "Write .git/x: Claude requested permissions to edit ~/work/.git/x which is a sensitive file.",
          "choices": [
            "allow",
            "deny",
          ],
        },
        {
          "stdin": {
            "response": {
              "request_id": "00000000-0000-0000-0000-000000000000",
              "response": {
                "behavior": "deny",
                "message": "The user denied this.",
              },
              "subtype": "success",
            },
            "type": "control_response",
          },
        },
      ],
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
    }
  `);
});

it('denies writes the CLI refuses without a card: outside the workspace, and .git/x in a background turn', async () => {
  const outside = await replay('write-outside', { asks: true, choice: ALLOW });
  const background = await replay('background-write-git', { asks: true, choice: ALLOW });
  const shown = (log: readonly unknown[]) => log.filter((entry) => typeof entry === 'object' && entry !== null && ('card' in entry || 'stdin' in entry || ('kind' in entry && entry.kind === 'tool-end')));
  expect({ outside: shown(outside.log), background: shown(background.log) }).toMatchInlineSnapshot(`
    {
      "background": [
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "toolu_01NVf9AsM7mWTdq4AgGhyh1z",
        },
      ],
      "outside": [
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "toolu_0186RmxLHwL1w4AyYUSAT9YP",
        },
      ],
    }
  `);
});

it('in read-only, has no Edit tool and refuses to read a file in the home folder', async () => {
  const edit = await replay('read-only-edit', { asks: false });
  const home = await replay('read-only-home', { asks: false });
  expect({ edit: edit.log, home: home.log }).toMatchInlineSnapshot(`
    {
      "edit": [
        {
          "input": {
            "file_path": "~/work/a.txt",
            "new_string": "bye",
            "old_string": "hello",
          },
          "kind": "tool-start",
          "name": "Edit",
          "toolUseId": "toolu_016pS8uaphQxJHAsQas1M4wS",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "toolu_016pS8uaphQxJHAsQas1M4wS",
        },
        {
          "usage": [
            {
              "id": "five_hour",
              "resetsAt": "2026-11-27T14:10:00.000Z",
              "usedPercent": 11,
            },
            {
              "id": "seven_day",
              "resetsAt": "2026-11-28T06:00:00.000Z",
              "usedPercent": 24,
            },
          ],
        },
        {
          "text": "I couldn't make the change. The Edit tool isn't available in this session, so \`a.txt\` is unchanged and still contains \`hello\`. I didn't use any other tool or retry, as you asked. If you enable Edit or want a different approach, I can make the replacement then.",
        },
        "stdin closed",
      ],
      "home": [
        {
          "usage": [
            {
              "id": "five_hour",
              "resetsAt": "2026-11-27T14:10:00.000Z",
              "usedPercent": 11,
            },
            {
              "id": "seven_day",
              "resetsAt": "2026-11-28T06:00:00.000Z",
              "usedPercent": 24,
            },
          ],
        },
        {
          "input": {
            "file_path": "~/x",
          },
          "kind": "tool-start",
          "name": "Read",
          "toolUseId": "toolu_013hjEqRz4ti6FZoeW6GoawD",
        },
        {
          "kind": "tool-end",
          "outcome": "error",
          "toolUseId": "toolu_013hjEqRz4ti6FZoeW6GoawD",
        },
        {
          "text": "I couldn't read \`/Users/tester/x\`. The Read tool is restricted to the working directory (\`/Users/tester/work\`), and the file is outside it. I didn't retry or use another tool, as you asked.

    If you want me to read it, you could copy it into the working directory or tell me a different path inside it. Or you could allow reads outside the working directory and I'll try again.",
        },
        "stdin closed",
      ],
    }
  `);
});
