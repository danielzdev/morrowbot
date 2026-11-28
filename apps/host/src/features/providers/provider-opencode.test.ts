import { mkdir, writeFile } from 'node:fs/promises';
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

const Info = (body: unknown): unknown => (typeof body === 'object' && body !== null && 'info' in body ? body.info : body);

it('starts one opencode acp daemon with its own folders and read-only config, reports models after the first session, and streams a reply', async () => {
  const first = await opencode.host.call('GET', '/api/plugins/provider-opencode/info');
  const agent = await opencode.agent();
  const thread = await opencode.thread(agent);
  const generationId = await opencode.start(thread, 'hello');
  await opencode.events.finished(generationId);
  await opencode.logged('session/close', 1);
  const second = await opencode.host.call('GET', '/api/plugins/provider-opencode/info');
  const [launch] = await opencode.launches();
  const config: unknown = JSON.parse(launch?.env?.OPENCODE_CONFIG_CONTENT ?? 'null');
  const deltas = opencode.turnEvents(generationId).flatMap((event) => (event.kind === 'generation.delta' ? [event.text] : []));
  expect(
    redact({
      first: Info(first.body),
      models: second.body !== null && typeof second.body === 'object' && 'info' in second.body ? second.body.info : null,
      launch: { args: launch?.args, env: { ...launch?.env, OPENCODE_CONFIG_CONTENT: config } },
      daemons: opencode.daemonPgids().length,
      sent: turnMethods(await opencode.log()),
      deltas,
      history: await opencode.history(thread),
    }),
  ).toMatchInlineSnapshot(`
    {
      "daemons": 1,
      "deltas": [
        "Echo: ",
        "hello",
      ],
      "first": {
        "accountKey": "",
        "accountLabel": "Free models",
        "capabilities": {
          "approvals": true,
          "profiles": [
            {
              "access": "read-only",
              "modes": [
                "interactive",
              ],
              "readsOutsideCwd": true,
              "vendorSettings": "isolated",
            },
            {
              "access": "full",
              "modes": [
                "interactive",
                "background",
              ],
              "readsOutsideCwd": true,
              "vendorSettings": "isolated",
            },
          ],
          "sessions": false,
          "usage": "none",
          "withheld": [
            {
              "access": "workspace-write",
              "reason": "MorrowBot cannot yet confine OpenCode file writes to the workspace, and opencode runs commands outside any sandbox.",
              "vendorSettings": "isolated",
            },
            {
              "access": "read-only",
              "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's SOUL.md is sent by MorrowBot instead.",
              "vendorSettings": "personal",
            },
            {
              "access": "workspace-write",
              "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's SOUL.md is sent by MorrowBot instead.",
              "vendorSettings": "personal",
            },
          ],
        },
        "kind": "ready-models-later",
        "version": "2.4.1",
        "warning": null,
      },
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
      ],
      "launch": {
        "args": [
          "acp",
        ],
        "env": {
          "HOME": "$HOME/data/plugin-data/provider-opencode/opencode/home",
          "OPENCODE_CONFIG_CONTENT": {
            "$schema": "https://opencode.ai/config.json",
            "agent": {
              "build": {
                "permission": {
                  "*": "deny",
                  "codesearch": "deny",
                  "external_directory": "ask",
                  "glob": "allow",
                  "grep": "allow",
                  "list": "allow",
                  "morrowbot_*": "allow",
                  "read": {
                    "*": "allow",
                    "*.env": "ask",
                    "*.env.*": "ask",
                    "*.env.example": "allow",
                  },
                  "webfetch": "ask",
                  "websearch": "deny",
                },
              },
              "explore": {
                "disable": true,
              },
              "full": {
                "mode": "primary",
                "permission": {
                  "*": "allow",
                },
              },
              "general": {
                "disable": true,
              },
              "plan": {
                "disable": true,
              },
            },
            "autoupdate": false,
            "formatter": false,
            "lsp": false,
            "permission": {
              "*": "deny",
              "codesearch": "deny",
              "external_directory": "ask",
              "glob": "allow",
              "grep": "allow",
              "list": "allow",
              "morrowbot_*": "allow",
              "read": {
                "*": "allow",
                "*.env": "ask",
                "*.env.*": "ask",
                "*.env.example": "allow",
              },
              "webfetch": "ask",
              "websearch": "deny",
            },
            "share": "disabled",
          },
          "OPENCODE_DISABLE_AUTOUPDATE": "1",
          "OPENCODE_DISABLE_CLAUDE_CODE": "1",
          "OPENCODE_DISABLE_EXTERNAL_SKILLS": "1",
          "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
          "XDG_CACHE_HOME": "$HOME/data/plugin-data/provider-opencode/opencode/cache",
          "XDG_CONFIG_HOME": "$HOME/data/plugin-data/provider-opencode/opencode/config",
          "XDG_DATA_HOME": "$HOME/data/plugin-data/provider-opencode/opencode/data",
          "XDG_STATE_HOME": "$HOME/data/plugin-data/provider-opencode/opencode/state",
        },
      },
      "models": {
        "accountKey": "",
        "accountLabel": "Free models",
        "capabilities": {
          "approvals": true,
          "profiles": [
            {
              "access": "read-only",
              "modes": [
                "interactive",
              ],
              "readsOutsideCwd": true,
              "vendorSettings": "isolated",
            },
            {
              "access": "full",
              "modes": [
                "interactive",
                "background",
              ],
              "readsOutsideCwd": true,
              "vendorSettings": "isolated",
            },
          ],
          "sessions": false,
          "usage": "none",
          "withheld": [
            {
              "access": "workspace-write",
              "reason": "MorrowBot cannot yet confine OpenCode file writes to the workspace, and opencode runs commands outside any sandbox.",
              "vendorSettings": "isolated",
            },
            {
              "access": "read-only",
              "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's SOUL.md is sent by MorrowBot instead.",
              "vendorSettings": "personal",
            },
            {
              "access": "workspace-write",
              "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's SOUL.md is sent by MorrowBot instead.",
              "vendorSettings": "personal",
            },
          ],
        },
        "kind": "ready",
        "models": [
          {
            "id": "opencode/big-pickle",
            "isDefault": true,
            "label": "Big Pickle",
            "options": [],
          },
          {
            "id": "opencode/fake-free",
            "isDefault": false,
            "label": "Fake Free",
            "options": [],
          },
        ],
        "version": "2.4.1",
        "warning": null,
      },
      "sent": [
        "session/new",
        "session/prompt",
        "session/close",
      ],
    }
  `);
});

it("sends the agent's SOUL.md, not the workspace's AGENTS.md, and the earlier conversation in the prompt, as opencode loads no workspace files", async () => {
  const agent = await opencode.agent();
  const workspace = path.join(opencode.home, 'data', 'workspaces', agent.id);
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'SOUL.md'), 'Answer in French.\n');
  await writeFile(path.join(workspace, 'AGENTS.md'), 'Repository rules.\n');
  const thread = await opencode.thread(agent);
  await opencode.send(thread, 'hello');
  await opencode.send(thread, 'again');
  const prompts = (await opencode.log()).flatMap((entry) => (entry.method === 'session/prompt' ? [entry.params] : []));
  expect(redact({ prompts, history: await opencode.history(thread) })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: again",
        "assistant(completed): Echo: again",
      ],
      "prompts": [
        {
          "prompt": [
            {
              "text": "<instructions>
    Answer in French.
    </instructions>

    hello",
              "type": "text",
            },
          ],
          "sessionId": "ses_<pid>_1",
        },
        {
          "prompt": [
            {
              "text": "<instructions>
    Answer in French.
    </instructions>

    Continue this conversation. Reply to the last user message.

    <conversation>
    <user>
    hello
    </user>
    <assistant>
    Echo: hello
    </assistant>
    <user>
    again
    </user>
    </conversation>",
              "type": "text",
            },
          ],
          "sessionId": "ses_<pid>_2",
        },
      ],
    }
  `);
});

it('sets the picked model on each new session, and refuses a model opencode does not have', async () => {
  const picked = await opencode.thread(await opencode.agent({ ...OPENCODE, selection: { kind: 'model', id: 'opencode/fake-free', choices: {} } }));
  await opencode.send(picked, 'hello');
  const configured = (await opencode.log()).filter((entry) => entry.method === 'session/set_config_option').map((entry) => entry.params);
  const refused = await opencode.thread(await opencode.agent({ ...OPENCODE, selection: { kind: 'model', id: 'opencode/gone', choices: {} } }));
  await opencode.send(refused, 'hello');
  expect(redact({ configured, histories: [await opencode.history(picked), await opencode.history(refused)] })).toMatchInlineSnapshot(`
    {
      "configured": [
        {
          "configId": "model",
          "sessionId": "ses_<pid>_1",
          "value": "opencode/fake-free",
        },
      ],
      "histories": [
        [
          "user: hello",
          "assistant(completed): Echo: hello",
        ],
        [
          "user: hello",
          "assistant(failed invalid-model): ",
        ],
      ],
    }
  `);
});

it("opens each session with MorrowBot's MCP server for that turn and no other", async () => {
  const thread = await opencode.thread(await opencode.agent());
  await opencode.events.finished(await opencode.start(thread, 'hello'));
  await opencode.events.finished(await opencode.start(thread, 'again'));
  const opened = (await opencode.log()).flatMap((entry) => (entry.method === 'session/new' ? [entry.params] : []));
  const tokens = new Set(JSON.stringify(opened).match(/Bearer [\w-]+/g));
  const shown: unknown = JSON.parse(JSON.stringify(redact(opened)).replace(/Bearer [\w-]+/g, 'Bearer <token>').replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>'));
  expect({ distinctTokens: tokens.size, opened: shown }).toMatchInlineSnapshot(`
    {
      "distinctTokens": 2,
      "opened": [
        {
          "cwd": "$HOME/data/workspaces/id-1",
          "mcpServers": [
            {
              "headers": [
                {
                  "name": "Authorization",
                  "value": "Bearer <token>",
                },
              ],
              "name": "morrowbot",
              "type": "http",
              "url": "http://127.0.0.1:<port>/mcp",
            },
          ],
        },
        {
          "cwd": "$HOME/data/workspaces/id-1",
          "mcpServers": [
            {
              "headers": [
                {
                  "name": "Authorization",
                  "value": "Bearer <token>",
                },
              ],
              "name": "morrowbot",
              "type": "http",
              "url": "http://127.0.0.1:<port>/mcp",
            },
          ],
        },
      ],
    }
  `);
});
