import { rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StartedSend } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type CodexFixture, NATIVE, startCodexFixture, turnMethods } from '../../testing/codex-fixture.ts';

let codex: CodexFixture;

beforeEach(async () => {
  codex = await startCodexFixture();
});

afterEach(async () => {
  await codex.close();
  expect(codex.host.errors).toEqual([]);
});

async function sendAndWait(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<string> {
  const reply = await codex.post(thread, text, sessionChoice);
  const { generationId } = StartedSend.parse(reply.body);
  await codex.events.finished(generationId);
  return generationId;
}

function tokens(generationId: string): unknown {
  const db = new DatabaseSync(path.join(codex.home, 'data', 'morrowbot.sqlite'), { readOnly: true });
  const row = db.prepare('SELECT input_tokens, cached_input_tokens, output_tokens FROM turn_usage WHERE generation_id = ?').get(generationId);
  db.close();
  return row;
}

function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(codex.home, '$HOME'));
}

/** The methods sent since the log had `from` entries. */
async function methodsSince(from: number): Promise<string[]> {
  return turnMethods((await codex.log()).slice(from));
}

it('after Recheck, cold-resumes the thread with its overrides and counts a replayed total as the baseline only', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'hello');
  expect((await codex.host.call('POST', '/api/plugins/provider-openai/recheck')).status).toBe(200);
  const from = (await codex.log()).length;
  const resumed = await sendAndWait(thread, 'again');
  const resume = (await codex.log()).slice(from).find((entry) => entry.method === 'thread/resume');
  expect(redact({ methods: await methodsSince(from), resume: resume?.params, tokens: tokens(resumed), history: await codex.history(thread) })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: again",
        "assistant(completed): Echo: again",
      ],
      "methods": [
        "thread/resume",
        "turn/start",
      ],
      "resume": {
        "approvalPolicy": "never",
        "config": {
          "features.apps": false,
          "features.browser_use": false,
          "features.browser_use_external": false,
          "features.code_mode_host": false,
          "features.computer_use": false,
          "features.hooks": false,
          "features.image_generation": false,
          "features.in_app_browser": false,
          "features.multi_agent": false,
          "features.multi_agent_v2": false,
          "features.plugins": false,
          "features.shell_snapshot": false,
          "features.shell_tool": false,
          "features.skill_mcp_dependency_install": false,
          "features.unified_exec": false,
          "mcp_servers.node_repl.enabled": false,
        },
        "cwd": "$HOME/data/workspaces/id-1",
        "excludeTurns": true,
        "modelProvider": "openai",
        "sandbox": "read-only",
        "threadId": "thread-1",
      },
      "tokens": {
        "cached_input_tokens": 60,
        "input_tokens": 40,
        "output_tokens": 10,
      },
    }
  `);
});

it('cold-loads a loaded thread whose policy changed, and refuses before the prompt when Codex keeps it loaded', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'hello');
  await codex.setState({ config: { ...NATIVE.config, mcp_servers: { node_repl: {}, other: {} } } });
  const from = (await codex.log()).length;
  await sendAndWait(thread, 'with a new MCP server');
  const reloaded = await methodsSince(from);
  await codex.setState({ config: NATIVE.config, keepLoaded: true });
  const stuckFrom = (await codex.log()).length;
  await sendAndWait(thread, 'policy back');
  expect({ reloaded, stuck: await methodsSince(stuckFrom), history: await codex.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: with a new MCP server",
        "assistant(completed): Echo: with a new MCP server",
        "user: policy back",
        "assistant(failed access-not-supported): ",
      ],
      "reloaded": [
        "thread/unsubscribe",
        "thread/resume",
        "turn/start",
      ],
      "stuck": [
        "thread/unsubscribe",
      ],
    }
  `);
});

it('refuses before the prompt when the daemon reports a hook it could not turn off', async () => {
  await codex.setState({ hooks: [{ event: 'PreToolUse', command: 'echo hi' }] });
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'hello');
  expect({ methods: turnMethods(await codex.logged('thread/unsubscribe', 1)), history: await codex.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed access-not-supported): ",
      ],
      "methods": [
        "thread/start",
        "thread/unsubscribe",
      ],
    }
  `);
});

it('declines an approval request without a card', async () => {
  const thread = await codex.thread(await codex.agent());
  const generationId = await sendAndWait(thread, 'ask');
  expect({
    replies: (await codex.log()).filter((entry) => entry.method === 'approval-reply').map((entry) => entry.params),
    cards: codex.turnEvents(generationId).filter((event) => event.kind === 'generation.approval-requested').length,
    statuses: codex.turnEvents(generationId).flatMap((event): string[] => (event.kind === 'generation.status' && event.detail !== null ? [event.detail] : [])),
    history: await codex.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "cards": 0,
      "history": [
        "user: ask",
        "assistant(completed): Echo: ask",
      ],
      "replies": [
        {
          "decision": "decline",
        },
      ],
      "statuses": [
        "Thinking",
        "Denied a Codex approval request: MorrowBot turns are read-only.",
      ],
    }
  `);
});

it('ends session-lost, sending nothing, when the saved thread is gone', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'hello');
  await rm(path.join(codex.home, 'fake-codex', 'threads.json'));
  expect((await codex.host.call('POST', '/api/plugins/provider-openai/recheck')).status).toBe(200);
  const from = (await codex.log()).length;
  await sendAndWait(thread, 'again');
  const lost = await methodsSince(from);
  const retried = await codex.post(thread, 'once more');
  expect({ lost, history: await codex.history(thread), retried: retried.body }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: again",
        "assistant(failed session-lost): ",
      ],
      "lost": [
        "thread/resume",
      ],
      "retried": {
        "error": {
          "kind": "session-choice-required",
          "message": "This thread has history the provider has not seen. Start a new session seeded from this thread.",
          "reason": "unseeded-history",
        },
      },
    }
  `);
});

it('a seeded new thread gets the earlier conversation before the prompt', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'hello');
  const from = (await codex.log()).length;
  await sendAndWait(thread, 'start over', { kind: 'new-seeded' });
  const start = (await codex.log()).slice(from).find((entry) => entry.method === 'turn/start');
  expect(start?.params).toMatchInlineSnapshot(`
    {
      "approvalPolicy": "never",
      "input": [
        {
          "text": "Continue this conversation. Reply to the last user message.

    <conversation>
    <user>
    hello
    </user>
    <assistant>
    Echo: hello
    </assistant>
    <user>
    start over
    </user>
    </conversation>",
          "text_elements": [],
          "type": "text",
        },
      ],
      "sandboxPolicy": {
        "networkAccess": false,
        "type": "readOnly",
      },
      "threadId": "thread-2",
    }
  `);
});
