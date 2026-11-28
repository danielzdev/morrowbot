import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type AgyFixture, startAgyFixture } from '../../testing/agy-fixture.ts';

let agy: AgyFixture;

beforeEach(async () => {
  agy = await startAgyFixture();
});

afterEach(async () => {
  await agy.close();
  expect(agy.host.errors).toEqual([]);
});

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(agy.home, '$HOME').replace(/sess-\d+-/g, 'sess-<pid>-'));
}

async function permissionReplies(): Promise<unknown[]> {
  return (await agy.log()).filter((entry) => entry.method === 'permission-reply' || entry.method === 'client-reply').map((entry) => entry.params);
}

async function workspaceFiles(): Promise<string[]> {
  const workspaces = path.join(agy.home, 'data', 'workspaces');
  const agents = await readdir(workspaces);
  return (await Promise.all(agents.map((agent) => readdir(path.join(workspaces, agent))))).flat();
}

it('denies a file write and a command without asking, so nothing is written or run', async () => {
  const thread = await agy.thread(await agy.agent());
  const write = await agy.start(thread, 'write a file');
  await agy.events.finished(write);
  const command = await agy.start(thread, 'run a command');
  await agy.events.finished(command);
  expect({ write: agy.steps(write), command: agy.steps(command), replies: await permissionReplies(), history: await agy.history(thread), files: await workspaceFiles() }).toMatchInlineSnapshot(`
    {
      "command": [
        "tool-start Shell: {"title":"touch ran.txt"}",
        "status: Denied execute touch ran.txt: Ori Bot runs Antigravity read-only.",
        "tool-end: error",
      ],
      "files": [],
      "history": [
        "user: write a file",
        "assistant(completed): ",
        "user: run a command",
        "assistant(completed): ",
      ],
      "replies": [
        {
          "error": null,
          "id": "agy-1",
          "result": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
        {
          "choice": "deny",
          "tool": "edit",
        },
        {
          "error": null,
          "id": "agy-2",
          "result": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
        {
          "choice": "deny",
          "tool": "execute",
        },
      ],
      "write": [
        "tool-start Edit: {"title":"File inside.txt"}",
        "status: Denied edit ~/data/workspaces/id-1/inside.txt: Ori Bot runs Antigravity read-only.",
        "tool-end: error",
      ],
    }
  `);
});

it('asks before reading outside the workspace: Allow reads it once, Deny fails the read', async () => {
  await writeFile(path.join(agy.home, 'outside.txt'), 'secret plans');
  const thread = await agy.thread(await agy.agent());
  const allowed = await agy.start(thread, 'read-outside please');
  const allowStatus = await agy.answer(thread, allowed, 'allow');
  await agy.events.finished(allowed);
  const denied = await agy.start(thread, 'read-outside again');
  const denyStatus = await agy.answer(thread, denied, 'deny');
  await agy.events.finished(denied);
  expect({ allowStatus, denyStatus, allowed: agy.steps(allowed), denied: agy.steps(denied), replies: await permissionReplies(), history: await agy.history(thread) }).toMatchInlineSnapshot(`
    {
      "allowStatus": 204,
      "allowed": [
        "tool-start Read: {"title":"File outside.txt"}",
        "card: Antigravity wants to read ~/outside.txt [allow, deny]",
        "card resolved: {"kind":"chosen","choiceId":"allow"}",
        "tool-end: ok",
      ],
      "denied": [
        "tool-start Read: {"title":"File outside.txt"}",
        "card: Antigravity wants to read ~/outside.txt [allow, deny]",
        "card resolved: {"kind":"chosen","choiceId":"deny"}",
        "tool-end: error",
      ],
      "denyStatus": 204,
      "history": [
        "user: read-outside please",
        "assistant(completed): outside says: secret plans",
        "user: read-outside again",
        "assistant(completed): ",
      ],
      "replies": [
        {
          "error": null,
          "id": "agy-1",
          "result": {
            "outcome": {
              "optionId": "allow",
              "outcome": "selected",
            },
          },
        },
        {
          "choice": "allow",
          "tool": "read",
        },
        {
          "error": null,
          "id": "agy-2",
          "result": {
            "outcome": {
              "optionId": "deny",
              "outcome": "selected",
            },
          },
        },
        {
          "choice": "deny",
          "tool": "read",
        },
      ],
    }
  `);
});

it('refuses a file write agy asks the client for, and the turn goes on', async () => {
  const thread = await agy.thread(await agy.agent());
  const turn = await agy.start(thread, 'fs-write');
  await agy.events.finished(turn);
  expect({ steps: agy.steps(turn), history: await agy.history(thread), files: await workspaceFiles() }).toMatchInlineSnapshot(`
    {
      "files": [],
      "history": [
        "user: fs-write",
        "assistant(completed): fs write: {"error":{"code":-32603,"message":"Ori Bot runs Antigravity read-only: it writes no files."}}",
      ],
      "steps": [
        "status: Refused Antigravity's fs/write_text_file: Ori Bot runs it read-only.",
      ],
    }
  `);
});

it('puts a session that starts in another mode back in Default mode, and refuses the turn when agy will not switch', async () => {
  await agy.setState({ startMode: 'accept-edits' });
  const thread = await agy.thread(await agy.agent());
  await agy.send(thread, 'hello');
  const switched = (await agy.log()).filter((entry) => entry.method === 'session/set_config_option' && JSON.stringify(entry.params).includes('"configId":"mode"')).map((entry) => entry.params);
  await agy.setState({ lockMode: true });
  await agy.send(thread, 'hello again');
  const prompts = (await agy.log()).filter((entry) => entry.method === 'session/prompt').length;
  expect(redact({ switched, prompts, history: await agy.history(thread) })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: hello again",
        "assistant(failed access-not-supported): ",
      ],
      "prompts": 1,
      "switched": [
        {
          "configId": "mode",
          "sessionId": "sess-<pid>-2",
          "value": "default",
        },
      ],
    }
  `);
});
