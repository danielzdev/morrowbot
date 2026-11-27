import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AcpFixture } from '../../testing/acp-fixture.ts';
import { FAKE_OPENCODE, OPENCODE, startOpenCodeFixture, turnMethods } from '../../testing/opencode-fixture.ts';

let opencode: AcpFixture;

beforeEach(async () => {
  opencode = await startOpenCodeFixture();
});

afterEach(async () => {
  await opencode.close();
  expect(opencode.host.errors).toEqual([]);
});

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(FAKE_OPENCODE, '<fake-opencode>').replaceAll(opencode.home, '$HOME').replace(/ses_\d+_/g, 'ses_<pid>_'));
}

it('denies a write opencode asks for without a card, and ends the reply as completed when opencode stops on the denial', async () => {
  const thread = await opencode.thread(await opencode.agent());
  const generationId = await opencode.start(thread, 'write a file');
  await opencode.events.finished(generationId);
  const replies = (await opencode.log()).flatMap((entry) => (entry.method === 'permission-reply' ? [entry.params] : []));
  expect(redact({ steps: opencode.steps(generationId), replies, history: await opencode.history(thread) })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: write a file",
        "assistant(completed): ",
      ],
      "replies": [
        {
          "choice": "reject",
          "tool": "edit",
        },
      ],
      "steps": [
        "tool-start Edit: {"title":"write"}",
        "status: Denied edit ~/data/workspaces/id-1/inside.txt: MorrowBot runs OpenCode read-only.",
        "tool-end: error",
      ],
    }
  `);
});

it('asks before a read outside the workspace: Allow reads it once, Deny ends the reply', async () => {
  await writeFile(path.join(opencode.home, 'outside.txt'), 'secret plans');
  const thread = await opencode.thread(await opencode.agent());
  const allowed = await opencode.start(thread, 'read-outside please');
  await opencode.answer(thread, allowed, 'allow');
  await opencode.events.finished(allowed);
  const denied = await opencode.start(thread, 'read-outside again');
  await opencode.answer(thread, denied, 'deny');
  await opencode.events.finished(denied);
  const replies = (await opencode.log()).flatMap((entry) => (entry.method === 'permission-reply' ? [entry.params] : []));
  expect(redact({ allowed: opencode.steps(allowed), denied: opencode.steps(denied), replies, history: await opencode.history(thread) })).toMatchInlineSnapshot(`
    {
      "allowed": [
        "tool-start Read: {"title":"read"}",
        "card: OpenCode wants to read ~/outside.txt [allow, deny]",
        "card resolved: {"kind":"chosen","choiceId":"allow"}",
        "tool-end: ok",
      ],
      "denied": [
        "tool-start Read: {"title":"read"}",
        "card: OpenCode wants to read ~/outside.txt [allow, deny]",
        "card resolved: {"kind":"chosen","choiceId":"deny"}",
        "tool-end: error",
      ],
      "history": [
        "user: read-outside please",
        "assistant(completed): outside says: secret plans",
        "user: read-outside again",
        "assistant(completed): ",
      ],
      "replies": [
        {
          "choice": "once",
          "tool": "read",
        },
        {
          "choice": "reject",
          "tool": "read",
        },
      ],
    }
  `);
});

it("refuses opencode's own request to write a file, and fails a rate-limited prompt as rate-limited", async () => {
  const thread = await opencode.thread(await opencode.agent());
  const write = await opencode.start(thread, 'fs-write');
  await opencode.events.finished(write);
  await opencode.send(thread, 'quota');
  expect(redact({ steps: opencode.steps(write), history: await opencode.history(thread) })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: fs-write",
        "assistant(completed): fs write: {"error":{"code":-32603,"message":"MorrowBot runs OpenCode read-only: it writes no files."}}",
        "user: quota",
        "assistant(failed rate-limited): ",
      ],
      "steps": [
        "status: Refused OpenCode's fs/write_text_file: MorrowBot runs it read-only.",
      ],
    }
  `);
});

it('refuses personal settings and workspace-write with their reasons before opencode is asked anything', async () => {
  const bindings = [{ ...OPENCODE, vendorSettings: 'personal' as const }, { ...OPENCODE, access: 'workspace-write' as const }];
  const replies = [];
  for (const binding of bindings) {
    const thread = await opencode.thread(await opencode.agent(binding));
    const reply = await opencode.post(thread, 'hello');
    replies.push({ status: reply.status, body: reply.body });
  }
  expect(redact({ replies, sent: turnMethods(await opencode.log()).filter((method) => method.startsWith('session/')) })).toMatchInlineSnapshot(`
    {
      "replies": [
        {
          "body": {
            "error": {
              "kind": "conflict",
              "message": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by MorrowBot instead.",
            },
          },
          "status": 409,
        },
        {
          "body": {
            "error": {
              "kind": "conflict",
              "message": "MorrowBot runs OpenCode read-only in this version: it cannot yet confine each file write to the workspace, and opencode runs commands outside any sandbox.",
            },
          },
          "status": 409,
        },
      ],
      "sent": [],
    }
  `);
});
