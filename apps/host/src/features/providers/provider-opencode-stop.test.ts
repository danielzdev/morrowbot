import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { AcpFixture } from '../../testing/acp-fixture.ts';
import { isRunning, until } from '../../testing/daemon-fixture.ts';
import { startOpenCodeFixture } from '../../testing/opencode-fixture.ts';
import { DEFAULT_PLUGIN_TIMEOUTS } from '../../testing/test-host.ts';

let opencode: AcpFixture | undefined;

afterEach(async () => {
  if (opencode === undefined) return;
  await opencode.close();
  expect(opencode.host.errors).toEqual([]);
  opencode = undefined;
});


function redact(fixture: AcpFixture, value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(fixture.home, '$HOME'));
}

it('Stop sends session/cancel and the turn ends cancelled; closing the host leaves no opencode process or child of it running', async () => {
  const fixture = (opencode = await startOpenCodeFixture());
  const thread = await fixture.thread(await fixture.agent());
  const generationId = await fixture.start(thread, 'spawn then stall');
  await fixture.logged('session/prompt', 1);
  const stop = await fixture.host.call('POST', `/api/threads/${thread.id}/stop`);
  await fixture.events.finished(generationId);
  const log = await fixture.logged('session/close', 1);
  const pids = [...(await fixture.launches()).map((launch) => launch.pid), ...log.flatMap((entry) => (entry.method === 'spawned' && typeof entry.params === 'object' && entry.params !== null && 'pid' in entry.params && typeof entry.params.pid === 'number' ? [entry.params.pid] : []))];
  const history = await fixture.history(thread);
  const runningBefore = pids.map(isRunning);
  await fixture.close();
  opencode = undefined;
  expect(fixture.host.errors).toEqual([]);
  await until(() => pids.every((pid) => !isRunning(pid)));
  expect({ stop: stop.status, sent: log.filter((entry) => entry.method.startsWith('session/')).map((entry) => entry.method), history, runningBefore, runningAfter: pids.map(isRunning) })
    .toMatchInlineSnapshot(`
      {
        "history": [
          "user: spawn then stall",
          "assistant(cancelled): ",
        ],
        "runningAfter": [
          false,
          false,
        ],
        "runningBefore": [
          true,
          true,
        ],
        "sent": [
          "session/new",
          "session/prompt",
          "session/cancel",
          "session/close",
        ],
        "stop": 200,
      }
    `);
});

it('a daemon that ignores session/cancel is killed after turnStopMs, the turn ends interrupted, and a new daemon serves the next turn', async () => {
  const fixture = (opencode = await startOpenCodeFixture({ timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 300 } }));
  const thread = await fixture.thread(await fixture.agent());
  const first = await fixture.start(thread, 'ignore-cancel');
  await fixture.logged('session/prompt', 1);
  const [pgid] = fixture.daemonPgids();
  const [launch] = await fixture.launches();
  await fixture.host.call('POST', `/api/threads/${thread.id}/stop`);
  await fixture.events.finished(first);
  await fixture.send(thread, 'after');
  const [replaced] = fixture.daemonPgids();
  expect({
    oldDaemonGone: launch !== undefined && !isRunning(launch.pid),
    newDaemon: replaced !== undefined && replaced !== pgid,
    daemons: fixture.daemonPgids().length,
    launches: (await fixture.launches()).length,
    history: await fixture.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "daemons": 1,
      "history": [
        "user: ignore-cancel",
        "assistant(interrupted): ",
        "user: after",
        "assistant(completed): Echo: after",
      ],
      "launches": 2,
      "newDaemon": true,
      "oldDaemonGone": true,
    }
  `);
});

it('an edit opencode reports finished without asking fails the turn, ends the daemon, and withholds the profile with no new daemon', async () => {
  const fixture = (opencode = await startOpenCodeFixture());
  const thread = await fixture.thread(await fixture.agent());
  const broken = await fixture.start(thread, 'sneaky edit');
  await fixture.events.finished(broken);
  const [launch] = await fixture.launches();
  await until(() => launch !== undefined && !isRunning(launch.pid) && fixture.daemonPgids().length === 0);
  const next = await fixture.post(thread, 'hello');
  const info = await fixture.host.call('GET', '/api/plugins/provider-opencode/info?refresh=1');
  const body: unknown = info.body;
  const withheld = typeof body === 'object' && body !== null && 'info' in body && typeof body.info === 'object' && body.info !== null && 'capabilities' in body.info ? body.info.capabilities : null;
  expect(redact(fixture, { steps: fixture.steps(broken), history: await fixture.history(thread), next: next.status, launches: (await fixture.launches()).length, withheld })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: sneaky edit",
        "assistant(failed access-not-supported): ",
      ],
      "launches": 1,
      "next": 409,
      "steps": [
        "tool-start Edit: {"title":"write"}",
        "tool-end: ok",
        "status: OpenCode (opencode 2.4.1) ran "Edit write" without asking. MorrowBot ended it and offers no OpenCode turns until the provider restarts.",
      ],
      "withheld": {
        "approvals": true,
        "profiles": [],
        "sessions": false,
        "usage": "none",
        "withheld": [
          {
            "access": "read-only",
            "reason": "OpenCode (opencode 2.4.1) ran "Edit write" without asking. MorrowBot ended it and offers no OpenCode turns until the provider restarts.",
            "vendorSettings": "isolated",
          },
          {
            "access": "workspace-write",
            "reason": "MorrowBot runs OpenCode read-only in this version: it cannot yet confine each file write to the workspace, and opencode runs commands outside any sandbox.",
            "vendorSettings": "isolated",
          },
          {
            "access": "read-only",
            "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by MorrowBot instead.",
            "vendorSettings": "personal",
          },
          {
            "access": "workspace-write",
            "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by MorrowBot instead.",
            "vendorSettings": "personal",
          },
          {
            "access": "full",
            "reason": "MorrowBot has not yet checked with a fixture that Stop ends every command opencode starts, so OpenCode has no full access.",
            "vendorSettings": "isolated",
          },
        ],
      },
    }
  `);
});

it('a session that leaves the build mode fails the turn and ends the daemon', async () => {
  const fixture = (opencode = await startOpenCodeFixture());
  const thread = await fixture.thread(await fixture.agent());
  const broken = await fixture.start(thread, 'switch-mode');
  await fixture.events.finished(broken);
  expect({ steps: fixture.steps(broken), history: await fixture.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: switch-mode",
        "assistant(failed access-not-supported): ",
      ],
      "steps": [
        "status: OpenCode (opencode 2.4.1) left its build mode for "plan". MorrowBot ended it and offers no OpenCode turns until the provider restarts.",
      ],
    }
  `);
});

it('reports missing-runtime with install guidance when opencode is not installed, and refuses a turn without starting anything', async () => {
  const fixture = (opencode = await startOpenCodeFixture());
  const missing = path.join(fixture.home, 'no-such-opencode');
  await fixture.host.call('PUT', '/api/plugins/provider-opencode/config', { config: { cliPath: missing } });
  const info = await fixture.host.call('GET', '/api/plugins/provider-opencode/info?refresh=1');
  const thread = await fixture.thread(await fixture.agent());
  const reply = await fixture.post(thread, 'hello');
  expect(redact(fixture, { info: info.body, reply: { status: reply.status, body: reply.body }, launches: (await fixture.launches()).length, daemons: fixture.daemonPgids().length }))
    .toMatchInlineSnapshot(`
      {
        "daemons": 0,
        "info": {
          "info": {
            "install": "Install opencode 2.4 from https://opencode.ai, or set "OpenCode CLI path".",
            "kind": "missing-runtime",
          },
        },
        "launches": 0,
        "reply": {
          "body": {
            "error": {
              "kind": "conflict",
              "message": "The provider's CLI is not installed. Install opencode 2.4 from https://opencode.ai, or set "OpenCode CLI path".",
            },
          },
          "status": 409,
        },
      }
    `);
});

it('on a system other than macOS, provider-info withholds read-only and starts no daemon, and a turn is refused', async () => {
  const fixture = (opencode = await startOpenCodeFixture({ platform: 'linux' }));
  const info = await fixture.host.call('GET', '/api/plugins/provider-opencode/info?refresh=1');
  const body: unknown = info.body;
  const profiles = typeof body === 'object' && body !== null && 'info' in body && typeof body.info === 'object' && body.info !== null && 'capabilities' in body.info ? body.info.capabilities : null;
  const thread = await fixture.thread(await fixture.agent());
  const reply = await fixture.post(thread, 'hello');
  expect({ profiles, reply: reply.status, launches: (await fixture.launches()).length, daemons: fixture.daemonPgids().length }).toMatchInlineSnapshot(`
    {
      "daemons": 0,
      "launches": 0,
      "profiles": {
        "approvals": true,
        "profiles": [],
        "sessions": false,
        "usage": "none",
        "withheld": [
          {
            "access": "read-only",
            "reason": "OpenCode in MorrowBot has been checked only on macOS so far, not on linux.",
            "vendorSettings": "isolated",
          },
          {
            "access": "workspace-write",
            "reason": "MorrowBot runs OpenCode read-only in this version: it cannot yet confine each file write to the workspace, and opencode runs commands outside any sandbox.",
            "vendorSettings": "isolated",
          },
          {
            "access": "read-only",
            "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by MorrowBot instead.",
            "vendorSettings": "personal",
          },
          {
            "access": "workspace-write",
            "reason": "MorrowBot turns off opencode's own workspace config, because opencode would also run the workspace's plugins and MCP servers from it. The agent's AGENTS.md is sent by MorrowBot instead.",
            "vendorSettings": "personal",
          },
          {
            "access": "full",
            "reason": "MorrowBot has not yet checked with a fixture that Stop ends every command opencode starts, so OpenCode has no full access.",
            "vendorSettings": "isolated",
          },
        ],
      },
      "reply": 409,
    }
  `);
});
