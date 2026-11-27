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

/** The turn's status details, approval cards and tool events. */
function steps(generationId: string): unknown {
  return redact(
    agy.turnEvents(generationId).flatMap((event) => {
      switch (event.kind) {
        case 'generation.status':
          return event.detail === null ? [] : [`status: ${event.detail}`];
        case 'generation.tool-start':
          return [`tool-start ${event.name}: ${JSON.stringify(event.input)}`];
        case 'generation.tool-end':
          return [`tool-end: ${event.outcome}`];
        case 'generation.approval-requested':
          return [`card: ${event.approval.summary} [${event.approval.choices.map((choice) => choice.id).join(', ')}]`];
        case 'generation.approval-resolved':
          return [`card resolved: ${JSON.stringify(event.resolution)}`];
        case 'generation.started':
        case 'generation.delta':
        case 'generation.finished':
        case 'usage.updated':
          return [];
      }
    }),
  );
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
  expect({ write: steps(write), command: steps(command), replies: await permissionReplies(), history: await agy.history(thread), files: await workspaceFiles() }).toMatchInlineSnapshot(`
    {
      "command": [
        "tool-start Shell: {"title":"touch ran.txt"}",
        "status: Denied execute touch ran.txt: MorrowBot runs Antigravity read-only.",
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
        "status: Denied edit ~/data/workspaces/id-1/inside.txt: MorrowBot runs Antigravity read-only.",
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
  expect({ allowStatus, denyStatus, allowed: steps(allowed), denied: steps(denied), replies: await permissionReplies(), history: await agy.history(thread) }).toMatchInlineSnapshot(`
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
  expect({ steps: steps(turn), history: await agy.history(thread), files: await workspaceFiles() }).toMatchInlineSnapshot(`
    {
      "files": [],
      "history": [
        "user: fs-write",
        "assistant(completed): fs write: {"error":{"code":-32603,"message":"MorrowBot runs Antigravity read-only: it writes no files."}}",
      ],
      "steps": [
        "status: Refused Antigravity's fs/write_text_file: MorrowBot runs it read-only.",
      ],
    }
  `);
});

it('stops a turn in which agy changes a file without asking, and offers no more turns until the provider restarts', async () => {
  const thread = await agy.thread(await agy.agent());
  const turn = await agy.start(thread, 'sneaky edit');
  await agy.events.finished(turn);
  const info = await agy.host.call('GET', '/api/plugins/provider-antigravity/info?refresh=1');
  const next = await agy.post(thread, 'hello');
  const cancels = (await agy.log()).filter((entry) => entry.method === 'session/cancel').length;
  expect(redact({ steps: steps(turn), cancels, history: await agy.history(thread), info: info.body, next: next.body })).toMatchInlineSnapshot(`
    {
      "cancels": 1,
      "history": [
        "user: sneaky edit",
        "assistant(failed access-not-supported): ",
      ],
      "info": {
        "info": {
          "accountKey": "",
          "accountLabel": "Google AI Pro",
          "capabilities": {
            "approvals": true,
            "profiles": [],
            "sessions": false,
            "usage": "none",
            "withheld": [
              {
                "access": "read-only",
                "reason": "Antigravity (agy 1.5.18) ran "Edit File sneaky.txt" without asking. MorrowBot stopped the turn and offers no Antigravity turns until it restarts.",
                "vendorSettings": "personal",
              },
              {
                "access": "workspace-write",
                "reason": "MorrowBot runs Antigravity read-only in this version: it cannot yet confine each file write to the workspace, and agy runs commands outside any sandbox.",
                "vendorSettings": "personal",
              },
              {
                "access": "read-only",
                "reason": "Antigravity always loads the workspace's own AGENTS.md (checked on agy 1.5.18), so MorrowBot cannot replace its instructions. The agent's AGENTS.md still applies.",
                "vendorSettings": "isolated",
              },
              {
                "access": "workspace-write",
                "reason": "Antigravity always loads the workspace's own AGENTS.md (checked on agy 1.5.18), so MorrowBot cannot replace its instructions. The agent's AGENTS.md still applies.",
                "vendorSettings": "isolated",
              },
            ],
          },
          "kind": "ready",
          "models": [
            {
              "id": "fake-pro",
              "isDefault": true,
              "label": "Fake Pro",
              "options": [
                {
                  "choices": [
                    {
                      "id": "low",
                      "label": "LOW",
                    },
                    {
                      "id": "high",
                      "label": "HIGH",
                    },
                  ],
                  "defaultChoiceId": "high",
                  "id": "thought_level",
                  "label": "Thinking Level",
                },
              ],
            },
            {
              "id": "fake-flash",
              "isDefault": false,
              "label": "Fake Flash",
              "options": [],
            },
          ],
          "version": "1.5.18",
          "warning": null,
        },
      },
      "next": {
        "error": {
          "kind": "conflict",
          "message": "Antigravity (agy 1.5.18) ran "Edit File sneaky.txt" without asking. MorrowBot stopped the turn and offers no Antigravity turns until it restarts.",
        },
      },
      "steps": [
        "tool-start Edit: {"title":"File sneaky.txt"}",
        "tool-end: ok",
        "status: Antigravity (agy 1.5.18) ran "Edit File sneaky.txt" without asking. MorrowBot stopped the turn and offers no Antigravity turns until it restarts.",
      ],
    }
  `);
});

it('stops a turn in which agy leaves Default mode', async () => {
  const thread = await agy.thread(await agy.agent());
  const turn = await agy.start(thread, 'switch-mode now');
  await agy.events.finished(turn);
  expect(redact({ steps: steps(turn), history: await agy.history(thread) })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: switch-mode now",
        "assistant(failed access-not-supported): ",
      ],
      "steps": [
        "status: Antigravity (agy 1.5.18) left its Default mode for "auto". MorrowBot stopped the turn and offers no Antigravity turns until it restarts.",
      ],
    }
  `);
});

it('puts a session that starts in another mode back in Default mode, and refuses the turn when agy will not switch', async () => {
  await agy.setState({ startMode: 'accept-edits' });
  const thread = await agy.thread(await agy.agent());
  await agy.send(thread, 'hello');
  const switched = (await agy.log()).filter((entry) => entry.method === 'session/set_config_option').map((entry) => entry.params);
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
          "sessionId": "sess-<pid>-1",
          "value": "default",
        },
      ],
    }
  `);
});
