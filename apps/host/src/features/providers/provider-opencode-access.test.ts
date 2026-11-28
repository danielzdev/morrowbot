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
        "status: Denied edit ~/data/workspaces/id-1/inside.txt: Ori Kami runs OpenCode read-only.",
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
        "assistant(completed): fs write: {"error":{"code":-32603,"message":"Ori Kami runs OpenCode read-only: it writes no files."}}",
        "user: quota",
        "assistant(failed rate-limited): ",
      ],
      "steps": [
        "status: Refused OpenCode's fs/write_text_file: Ori Kami runs it read-only.",
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
              "message": "Ori Kami turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by Ori Kami instead.",
            },
          },
          "status": 409,
        },
        {
          "body": {
            "error": {
              "kind": "conflict",
              "message": "Ori Kami cannot yet confine OpenCode file writes to the workspace, and opencode runs commands outside any sandbox.",
            },
          },
          "status": 409,
        },
      ],
      "sent": [],
    }
  `);
});

it('runs full-access turns in full mode without tripping the read-only fence, auto-approves requests, and keeps read-only turns strictly fenced', async () => {
  const fullThread = await opencode.thread(await opencode.agent({ ...OPENCODE, access: 'full' }));
  const toolsTurn = await opencode.start(fullThread, 'run-tools');
  await opencode.events.finished(toolsTurn);
  const writeTurn = await opencode.start(fullThread, 'write a file');
  await opencode.events.finished(writeTurn);
  const readOnlyThread = await opencode.thread(await opencode.agent(OPENCODE));
  const deniedTurn = await opencode.start(readOnlyThread, 'write a file');
  await opencode.events.finished(deniedTurn);
  const modeSets = (await opencode.log()).filter((entry) => entry.method === 'session/set_config_option').map((entry) => entry.params);
  const replies = (await opencode.log()).flatMap((entry) => (entry.method === 'permission-reply' ? [entry.params] : []));
  expect(
    redact({
      modeSets,
      toolsSteps: opencode.steps(toolsTurn),
      writeSteps: opencode.steps(writeTurn),
      readOnlySteps: opencode.steps(deniedTurn),
      replies,
      fullHistory: await opencode.history(fullThread),
      readOnlyHistory: await opencode.history(readOnlyThread),
      daemons: opencode.daemonPgids().length,
    }),
  ).toMatchInlineSnapshot(`
    {
      "daemons": 1,
      "fullHistory": [
        "user: run-tools",
        "assistant(completed): Ran tools in full",
        "user: write a file",
        "assistant(completed): wrote inside.txt",
      ],
      "modeSets": [
        {
          "configId": "mode",
          "sessionId": "ses_<pid>_1",
          "value": "full",
        },
        {
          "configId": "mode",
          "sessionId": "ses_<pid>_2",
          "value": "full",
        },
      ],
      "readOnlyHistory": [
        "user: write a file",
        "assistant(completed): ",
      ],
      "readOnlySteps": [
        "tool-start Edit: {"title":"write"}",
        "status: Denied edit ~/data/workspaces/id-9/inside.txt: Ori Kami runs OpenCode read-only.",
        "tool-end: error",
      ],
      "replies": [
        {
          "choice": "once",
          "tool": "edit",
        },
        {
          "choice": "reject",
          "tool": "edit",
        },
      ],
      "toolsSteps": [
        "tool-start Edit: {"title":"write"}",
        "tool-end: ok",
        "tool-start Shell: {"title":"bash"}",
        "tool-end: ok",
      ],
      "writeSteps": [
        "tool-start Edit: {"title":"write"}",
        "tool-end: ok",
      ],
    }
  `);
});

it('ignores a late completed tool update after a full session closes, while a concurrent read-only breach still trips the fence for both turns', async () => {
  const fullThread = await opencode.thread(await opencode.agent({ ...OPENCODE, access: 'full' }));
  const lateTurn = await opencode.start(fullThread, 'late-tool');
  await opencode.events.finished(lateTurn);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const afterLate = await opencode.start(fullThread, 'stall');
  await opencode.logged('session/prompt', 2);
  const readOnlyThread = await opencode.thread(await opencode.agent(OPENCODE));
  const breached = await opencode.start(readOnlyThread, 'sneaky edit');
  await opencode.events.finished(breached);
  await opencode.events.finished(afterLate);
  expect({ fullHistory: await opencode.history(fullThread), readOnlyHistory: await opencode.history(readOnlyThread) }).toMatchInlineSnapshot(`
    {
      "fullHistory": [
        "user: late-tool",
        "assistant(completed): Done",
        "user: stall",
        "assistant(failed access-not-supported): ",
      ],
      "readOnlyHistory": [
        "user: sneaky edit",
        "assistant(failed access-not-supported): ",
      ],
    }
  `);
});
