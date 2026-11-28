import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { cliProbe } from './cli-probe.ts';

/** `t3 thread show --json` for a waiting thread, as captured live in Step 0 (ids shortened, extra fields kept). */
const LIVE_SHOW = {
  thread: {
    threadId: 'mcp:1fae7cf2',
    projectId: 'df43ae45',
    title: 'Build the probe',
    link: 'https://app.t3.codes/threads/x/mcp%3A1fae7cf2',
    status: 'waiting',
    latestRunId: 'run:thread:mcp%3A1fae7cf2:ordinal:12',
    activeRunId: 'run:thread:mcp%3A1fae7cf2:ordinal:12',
    runCount: 12,
    itemCount: 240,
    pendingRequestCount: 0,
    pendingBackgroundTasks: [{ taskId: 'task-2', kind: 'subagent', childThreadId: 'mcp:child' }, { taskId: 'task-1', kind: 'command', awaited: true }],
    blockedOnThreadWait: false,
    pullRequests: [{ host: 'github.com', repository: 'example/repo', number: 7, url: 'https://github.com/example/repo/pull/7', source: 'agent', state: 'open', watching: false, watchStartedAt: null }],
    branch: 'feat/probe',
    worktreePath: '/tmp/worktree',
    createdAt: '2026-11-27T20:00:00.000Z',
    updatedAt: '2026-11-27T21:00:00.000Z',
  },
  messages: [{ role: 'assistant', runId: 'run:thread:mcp%3A1fae7cf2:ordinal:12', text: 'Working on it.' }],
  error: null,
};

let dir: string;
let bin: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-t3-cli-'));
  bin = path.join(dir, 't3');
  await writeFile(path.join(dir, 'show.json'), JSON.stringify(LIVE_SHOW));
  await writeFile(path.join(dir, 'failed.json'), JSON.stringify({ thread: { ...LIVE_SHOW.thread, status: 'failed', activeRunId: null, pendingBackgroundTasks: [] }, messages: [], error: 'Provider exited with code 1' }));
  await writeFile(path.join(dir, 'drift.json'), JSON.stringify({ thread: { ...LIVE_SHOW.thread, status: 'paused' }, messages: [], error: null }));
  await writeFile(path.join(dir, 'list.json'), JSON.stringify([{ ...LIVE_SHOW.thread, activeRunId: undefined }]));
  await writeFile(
    bin,
    `#!/bin/sh
echo "Electron: codesign check skipped" >&2
case "$*" in
  "thread show --messages 2 --json mcp:live") cat "${dir}/show.json" ;;
  "thread show --messages 2 --json mcp:failed") cat "${dir}/failed.json" ;;
  "thread show --messages 2 --json mcp:drift") cat "${dir}/drift.json" ;;
  "thread show --messages 2 --json mcp:gone") echo "Thread mcp:gone is no longer available." >&2; exit 1 ;;
  "thread show --messages 2 --json mcp:down") echo "No running T3 Code server uses /home/user/.t3. Start T3 Code, then retry." >&2; exit 1 ;;
  "thread show --messages 2 --json mcp:old") echo "The server sent an unexpected t3_thread_read result. Update the t3 CLI to match the server." >&2; exit 1 ;;
  "thread show --messages 2 --json mcp:text") echo "Build the probe" ;;
  "thread list --project p1 --json") cat "${dir}/list.json" ;;
  *) echo "unexpected: $*" >&2; exit 3 ;;
esac
`,
  );
  await chmod(bin, 0o755);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('reads a live-shaped show and tells not-found, unreachable and drift apart from the CLI’s own messages', async () => {
  const probe = cliProbe(bin);
  const results = await Promise.all(['mcp:live', 'mcp:failed', 'mcp:gone', 'mcp:down', 'mcp:old', 'mcp:drift', 'mcp:text'].map((id) => probe.inspect(id)));
  const missing = await cliProbe(path.join(dir, 'no-such-t3')).inspect('mcp:live');
  expect({ results, missingBinary: missing.kind }).toMatchInlineSnapshot(`
    {
      "missingBinary": "unreachable",
      "results": [
        {
          "kind": "observation",
          "observation": {
            "activeRunId": "run:thread:mcp%3A1fae7cf2:ordinal:12",
            "background": {
              "kind": "known",
              "value": {
                "blockedOnThreadWait": false,
                "taskIds": [
                  "task-1",
                  "task-2",
                ],
              },
            },
            "createdAt": {
              "kind": "known",
              "value": 1795809600000,
            },
            "error": null,
            "itemCount": 240,
            "latestRunId": "run:thread:mcp%3A1fae7cf2:ordinal:12",
            "pendingRequests": {
              "kind": "known",
              "value": 0,
            },
            "status": "waiting",
            "threadId": "mcp:1fae7cf2",
          },
        },
        {
          "kind": "observation",
          "observation": {
            "activeRunId": null,
            "background": {
              "kind": "known",
              "value": {
                "blockedOnThreadWait": false,
                "taskIds": [],
              },
            },
            "createdAt": {
              "kind": "known",
              "value": 1795809600000,
            },
            "error": "Provider exited with code 1",
            "itemCount": 240,
            "latestRunId": "run:thread:mcp%3A1fae7cf2:ordinal:12",
            "pendingRequests": {
              "kind": "known",
              "value": 0,
            },
            "status": "failed",
            "threadId": "mcp:1fae7cf2",
          },
        },
        {
          "kind": "not_found",
        },
        {
          "detail": "No running T3 Code server uses /home/user/.t3. Start T3 Code, then retry.",
          "kind": "unreachable",
        },
        {
          "detail": "The server sent an unexpected t3_thread_read result. Update the t3 CLI to match the server.",
          "kind": "schema_mismatch",
        },
        {
          "detail": "thread.status: Invalid option: expected one of "idle"|"preparing"|"queued"|"starting"|"running"|"waiting"|"completed"|"interrupted"|"failed"|"cancelled"|"rolled_back"",
          "kind": "schema_mismatch",
        },
        {
          "detail": "show printed something other than JSON",
          "kind": "schema_mismatch",
        },
      ],
    }
  `);
});

it('lists a project’s threads with only the fields discovery uses', async () => {
  expect(await cliProbe(bin).list('p1')).toMatchInlineSnapshot(`
    {
      "kind": "threads",
      "threads": [
        {
          "latestRunId": "run:thread:mcp%3A1fae7cf2:ordinal:12",
          "status": "waiting",
          "threadId": "mcp:1fae7cf2",
        },
      ],
    }
  `);
});
