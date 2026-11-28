import { StartedSend } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CODEX, type CodexFixture, startCodexFixture, turnMethods } from '../../testing/codex-fixture.ts';

let codex: CodexFixture;

beforeEach(async () => {
  codex = await startCodexFixture();
});

afterEach(async () => {
  await codex.close();
  expect(codex.host.errors).toEqual([]);
});

function redact(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll(codex.home, '$HOME')
      .replace(/Bearer [\w-]+/g, 'Bearer <token>')
      .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>'),
  );
}

async function sendAndWait(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<string> {
  const reply = await codex.post(thread, text, sessionChoice);
  const { generationId } = StartedSend.parse(reply.body);
  await codex.events.finished(generationId);
  return generationId;
}

it('runs full-access turns with danger-full-access sandbox, no lockdown feature overrides, and dangerFullAccess turn policy while keeping read-only strict', async () => {
  const fullThread = await codex.thread(await codex.agent({ ...CODEX, access: 'full' }));
  await sendAndWait(fullThread, 'tool please');
  const readOnlyThread = await codex.thread(await codex.agent(CODEX));
  await sendAndWait(readOnlyThread, 'hello');
  const log = await codex.log();
  const threadStarts = log.filter((entry) => entry.method === 'thread/start').map((entry) => entry.params);
  const turnStarts = log.filter((entry) => entry.method === 'turn/start').map((entry) => entry.params);
  expect(redact({ threadStarts, turnStarts, fullHistory: await codex.history(fullThread), readOnlyHistory: await codex.history(readOnlyThread) })).toMatchInlineSnapshot(`
    {
      "fullHistory": [
        "user: tool please",
        "assistant(completed): Echo: tool please",
      ],
      "readOnlyHistory": [
        "user: hello",
        "assistant(completed): Echo: hello",
      ],
      "threadStarts": [
        {
          "approvalPolicy": "never",
          "config": {
            "mcp_servers.morrowbot": {
              "default_tools_approval_mode": "approve",
              "enabled": true,
              "http_headers": {
                "Authorization": "Bearer <token>",
              },
              "url": "http://127.0.0.1:<port>/mcp",
            },
          },
          "cwd": "$HOME/data/workspaces/id-1",
          "ephemeral": false,
          "modelProvider": "openai",
          "sandbox": "danger-full-access",
        },
        {
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
            "mcp_servers.morrowbot": {
              "default_tools_approval_mode": "approve",
              "enabled": true,
              "http_headers": {
                "Authorization": "Bearer <token>",
              },
              "url": "http://127.0.0.1:<port>/mcp",
            },
            "mcp_servers.node_repl.enabled": false,
          },
          "cwd": "$HOME/data/workspaces/id-6",
          "ephemeral": false,
          "modelProvider": "openai",
          "sandbox": "read-only",
        },
      ],
      "turnStarts": [
        {
          "approvalPolicy": "never",
          "input": [
            {
              "text": "tool please",
              "text_elements": [],
              "type": "text",
            },
          ],
          "sandboxPolicy": {
            "type": "dangerFullAccess",
          },
          "threadId": "thread-1",
        },
        {
          "approvalPolicy": "never",
          "input": [
            {
              "text": "hello",
              "text_elements": [],
              "type": "text",
            },
          ],
          "sandboxPolicy": {
            "networkAccess": false,
            "type": "readOnly",
          },
          "threadId": "thread-2",
        },
      ],
    }
  `);
});

it('Stop cancels a full-access Codex turn via turn/interrupt and leaves the daemon serving the next turn', async () => {
  const thread = await codex.thread(await codex.agent({ ...CODEX, access: 'full' }));
  const generationId = StartedSend.parse((await codex.post(thread, 'stall')).body).generationId;
  await codex.logged('turn/start', 1);
  const [pgid] = codex.daemonPgids();
  const from = (await codex.log()).length;
  const stop = await codex.host.call('POST', `/api/threads/${thread.id}/stop`);
  await codex.events.finished(generationId);
  const afterStop = turnMethods((await codex.log()).slice(from));
  await sendAndWait(thread, 'after', { kind: 'continue-existing' });
  expect({ stop: stop.status, sameDaemon: codex.daemonPgids()[0] === pgid, afterStop, history: await codex.history(thread) }).toMatchInlineSnapshot(`
    {
      "afterStop": [
        "turn/interrupt",
        "thread/unsubscribe",
      ],
      "history": [
        "user: stall",
        "assistant(cancelled): ",
        "user: after",
        "assistant(completed): Echo: after",
      ],
      "sameDaemon": true,
      "stop": 200,
    }
  `);
});
