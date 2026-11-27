import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import type { Reply } from './testing/test-host.ts';

let chat: ChatFixture;
beforeEach(async () => {
  chat = await startChatFixture();
});
afterEach(async () => {
  await chat.close();
  expect(chat.host.errors).toEqual([]);
});

/** The status, or the refusal reason, of each send. */
function outcome(reply: Reply): string {
  const body = reply.body;
  if (reply.status === 202) return '202';
  if (typeof body === 'object' && body !== null && 'error' in body) return `${String(reply.status)} ${JSON.stringify(body.error)}`;
  return String(reply.status);
}

it('binds a session on the first turn, resumes it, and asks before reusing history after the session is lost', async () => {
  await chat.configure({ sessions: true });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const sends = [
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'session-lost')),
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'describe', { kind: 'new-seeded' })),
    outcome(await chat.send(thread, 'describe')),
  ];
  expect(sends).toMatchInlineSnapshot(`
    [
      "202",
      "202",
      "202",
      "409 {"kind":"session-choice-required","reason":"unseeded-history","message":"This thread has history the provider has not seen. Start a new session seeded from this thread."}",
      "202",
      "202",
    ]
  `);
  expect(await chat.history(thread)).toMatchInlineSnapshot(`
    [
      "user: describe",
      "assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":null},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
      "user: describe",
      "assistant(completed): hello from pid <pid>: {"session":{"kind":"resume","ref":"ref-id-3"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
      "user: session-lost",
      "assistant(failed session-lost): hello from pid <pid>:",
      "user: describe",
      "assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":"<user>\\ndescribe\\n</user>\\n<assistant>\\nhello from pid <pid>: {\\"session\\":{\\"kind\\":\\"new\\",\\"seed\\":null},\\"system\\":\\"\\",\\"selection\\":{\\"kind\\":\\"default\\"},\\"expectedAccountKey\\":\\"acct-a\\"}\\n</assistant>\\n<user>\\ndescribe\\n</user>\\n<assistant>\\nhello from pid <pid>: {\\"session\\":{\\"kind\\":\\"resume\\",\\"ref\\":\\"ref-id-3\\"},\\"system\\":\\"\\",\\"selection\\":{\\"kind\\":\\"default\\"},\\"expectedAccountKey\\":\\"acct-a\\"}\\n</assistant>\\n<user>\\nsession-lost\\n</user>\\n<assistant>\\nhello from pid <pid>:\\n</assistant>"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
      "user: describe",
      "assistant(completed): hello from pid <pid>: {"session":{"kind":"resume","ref":"ref-id-12"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
    ]
  `);
});

it('never resumes a changed AGENTS.md, even with continue-existing', async () => {
  await chat.configure({ sessions: true });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'hi');
  await writeFile(path.join(agent.workspace.dir, 'AGENTS.md'), 'New rules.');
  expect([
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'describe', { kind: 'continue-existing' })),
  ]).toMatchInlineSnapshot(`
    [
      "409 {"kind":"session-choice-required","reason":"instructions-changed","message":"The agent's instructions changed since the session started. Start a new session seeded from this thread."}",
      "409 {"kind":"session-choice-required","reason":"instructions-changed","message":"The agent's instructions changed since the session started. Start a new session seeded from this thread."}",
    ]
  `);
});

it('keeps an interrupted or untouched session honest: diverged needs a choice, untouched restores the prior state', async () => {
  await chat.configure({ sessions: true });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'hi');
  const sends = [
    outcome(await chat.send(thread, 'untouched')),
    outcome(await chat.send(thread, 'fail')),
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'describe', { kind: 'continue-existing' })),
    outcome(await chat.send(thread, 'describe')),
  ];
  expect(sends).toMatchInlineSnapshot(`
    [
      "202",
      "202",
      "409 {"kind":"session-choice-required","reason":"diverged","message":"The last turn in the saved session did not finish. Continue it anyway, or start a new session seeded from this thread."}",
      "202",
      "409 {"kind":"session-choice-required","reason":"diverged","message":"The last turn in the saved session did not finish. Continue it anyway, or start a new session seeded from this thread."}",
    ]
  `);
  expect((await chat.history(thread)).slice(-4)).toMatchInlineSnapshot(`
    [
      "user: fail",
      "assistant(failed other): hello from pid <pid>:",
      "user: describe",
      "assistant(completed): hello from pid <pid>: {"session":{"kind":"resume","ref":"ref-id-3"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}",
    ]
  `);
});

it('marks the session needs-seed on route-changed even when the plugin did not touch it', async () => {
  await chat.configure({ sessions: true });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const sends = [
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'route-changed')),
    outcome(await chat.send(thread, 'describe')),
    outcome(await chat.send(thread, 'describe', { kind: 'continue-existing' })),
  ];
  expect(sends).toMatchInlineSnapshot(`
    [
      "202",
      "202",
      "409 {"kind":"session-choice-required","reason":"unseeded-history","message":"This thread has history the provider has not seen. Start a new session seeded from this thread."}",
      "409 {"kind":"session-choice-required","reason":"unseeded-history","message":"This thread has history the provider has not seen. Start a new session seeded from this thread."}",
    ]
  `);
});

it("treats an unknown account ('') as stateless: full seed every turn, never a session choice", async () => {
  await chat.configure({ sessions: true, accountKey: '' });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const sends = [];
  for (const text of ['one', 'two', 'describe']) sends.push(outcome(await chat.send(thread, text)));
  expect(sends).toMatchInlineSnapshot(`
    [
      "202",
      "202",
      "202",
    ]
  `);
  expect((await chat.history(thread)).at(-1)).toMatchInlineSnapshot(`"assistant(completed): hello from pid <pid>: {"session":{"kind":"new","seed":"<user>\\none\\n</user>\\n<assistant>\\nhello from pid <pid>: one\\n</assistant>\\n<user>\\ntwo\\n</user>\\n<assistant>\\nhello from pid <pid>: two\\n</assistant>"},"system":"","selection":{"kind":"default"},"expectedAccountKey":""}"`);
});

it("keeps sessions per route: a blank route never asks, a known one still resumes", async () => {
  const blankAgent = await chat.agent();
  const knownAgent = await chat.agent();
  await chat.configure({ sessions: true, blankCwd: path.basename(blankAgent.workspace.dir) });
  const blank = await chat.thread(blankAgent);
  const known = await chat.thread(knownAgent);
  const sends = [];
  for (const text of ['one', 'two', 'three']) sends.push(outcome(await chat.send(blank, text)));
  sends.push(outcome(await chat.send(known, 'one')), outcome(await chat.send(known, 'describe')));
  expect(sends).toMatchInlineSnapshot(`
    [
      "202",
      "202",
      "202",
      "202",
      "202",
    ]
  `);
  expect((await chat.history(known)).at(-1)).toMatchInlineSnapshot(`"assistant(completed): hello from pid <pid>: {"session":{"kind":"resume","ref":"ref-id-14"},"system":"","selection":{"kind":"default"},"expectedAccountKey":"acct-a"}"`);
});

it('A → B → A: a turn on another account marks the first session needs-seed', async () => {
  await chat.configure({ sessions: true });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'on A');
  await chat.signIn('acct-b');
  const onB = [outcome(await chat.send(thread, 'describe')), outcome(await chat.send(thread, 'describe', { kind: 'new-seeded' }))];
  await chat.signIn('acct-a');
  const backOnA = [outcome(await chat.send(thread, 'describe')), outcome(await chat.send(thread, 'describe', { kind: 'continue-existing' }))];
  expect({ onB, backOnA }).toMatchInlineSnapshot(`
    {
      "backOnA": [
        "409 {"kind":"session-choice-required","reason":"unseeded-history","message":"This thread has history the provider has not seen. Start a new session seeded from this thread."}",
        "409 {"kind":"session-choice-required","reason":"unseeded-history","message":"This thread has history the provider has not seen. Start a new session seeded from this thread."}",
      ],
      "onB": [
        "409 {"kind":"session-choice-required","reason":"unseeded-history","message":"This thread has history the provider has not seen. Start a new session seeded from this thread."}",
        "202",
      ],
    }
  `);
});

it('refuses a send when route-info fails, and writes nothing', async () => {
  await chat.configure({ sessions: true, routeInfo: 'fail' });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const reply = await chat.send(thread, 'hi');
  expect({ reply, history: await chat.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [],
      "reply": {
        "body": {
          "error": {
            "kind": "provider-unavailable",
            "message": "The provider could not say which account it uses. Try again.",
            "reason": "route-info-failed",
          },
        },
        "status": 503,
      },
    }
  `);
});
