import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, MessageList, StartedSend, Thread, UsageResponse, type AccessLevel, type ChatEvent, type ProviderBinding } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startTestHost, type EventClient, type TestHost } from '../../testing/test-host.ts';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.ts', import.meta.url));

let home = '';
let host: TestHost;
let events: EventClient;

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-claude-access-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  vi.stubEnv('USER', 'tester');
  /** Workspace-write is offered on macOS only: these turns run as on macOS everywhere. */
  host = await startTestHost({ dataDir: path.join(home, 'data'), platform: 'darwin' });
  events = await host.events();
  expect((await host.call('PUT', '/api/plugins/provider-claude/config', { config: { cliPath: FAKE_CLAUDE } })).status).toBe(200);
});

afterEach(async () => {
  await host.close();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
  expect(host.errors).toEqual([]);
});

const binding = (access: AccessLevel): ProviderBinding => ({
  kind: 'bound',
  pluginId: 'provider-claude',
  selection: { kind: 'default' },
  access,
  vendorSettings: 'isolated',
});

async function agentThread(access: AccessLevel): Promise<{ readonly thread: Thread; readonly workspace: string }> {
  const agent = Agent.parse((await host.call('POST', '/api/agents', { name: 'Helper', provider: binding(access) })).body);
  const thread = Thread.parse((await host.call('POST', `/api/agents/${agent.id}/threads`, { title: 'Chat' })).body);
  await events.watch(thread.id);
  return { thread, workspace: path.join(home, 'data', 'workspaces', agent.id) };
}

async function start(thread: Thread, text: string): Promise<string> {
  const reply = await host.call('POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice: { kind: 'auto' } });
  return StartedSend.parse(reply.body).generationId;
}

/** Waits for the turn's approval card and answers it with `choiceId`. */
async function answer(thread: Thread, generationId: string, choiceId: string): Promise<number> {
  const requested = (event: ChatEvent) => event.kind === 'generation.approval-requested' && event.generationId === generationId;
  await events.until(requested);
  const card = events.received.find(requested);
  const approvalId = card?.kind === 'generation.approval-requested' ? card.approval.approvalId : '';
  return (await host.call('POST', `/api/threads/${thread.id}/approvals/${approvalId}`, { generationId, choiceId })).status;
}

async function history(of: Thread): Promise<string[]> {
  const { messages } = MessageList.parse((await host.call('GET', `/api/threads/${of.id}/messages`)).body);
  return messages.map((message) => {
    if (message.kind === 'user') return `user: ${message.text}`;
    const outcome = message.outcome.kind === 'failed' ? `failed ${JSON.stringify(message.outcome.error)}` : message.outcome.kind;
    return `assistant(${outcome}): ${message.text}`;
  });
}

/** The approval events of a turn, with the approval id and home folder hidden. */
function approvals(generationId: string): unknown[] {
  return events
    .of(generationId)
    .filter((event) => typeof event === 'object' && event !== null && 'kind' in event && String(event.kind).startsWith('generation.approval'))
    .map((event) => reparse(JSON.stringify(event).replaceAll(/"approvalId":"[^"]+"/g, '"approvalId":"<id>"').replaceAll(home, '$HOME')));
}

const reparse = (json: string): unknown => JSON.parse(json);

const written = (workspace: string) => readFile(path.join(workspace, '.git', 'x'), 'utf8').catch(() => null);

/** Workspace-write is offered on macOS only (`packages/providers/src/claude/info.ts`). */
it('asks before a workspace-write turn writes .git/x: Allow writes it, Deny leaves it unwritten', async () => {
  const allowed = await agentThread('workspace-write');
  const allowTurn = await start(allowed.thread, 'write-git');
  const allowReply = await answer(allowed.thread, allowTurn, 'allow');
  await events.finished(allowTurn);
  const denied = await agentThread('workspace-write');
  const denyTurn = await start(denied.thread, 'write-git');
  const denyReply = await answer(denied.thread, denyTurn, 'deny');
  await events.finished(denyTurn);
  expect({
    allow: { reply: allowReply, events: approvals(allowTurn), history: await history(allowed.thread), file: await written(allowed.workspace) },
    deny: { reply: denyReply, history: await history(denied.thread), file: await written(denied.workspace) },
  }).toMatchInlineSnapshot(`
    {
      "allow": {
        "events": [
          {
            "approval": {
              "approvalId": "<id>",
              "choices": [
                {
                  "id": "allow",
                  "label": "Allow",
                },
                {
                  "id": "deny",
                  "label": "Deny",
                },
              ],
              "summary": "Write .git/x: Claude requested permissions to edit ~/data/workspaces/id-1/.git/x which is a sensitive file.",
            },
            "generationId": "id-3",
            "kind": "generation.approval-requested",
            "threadId": "id-2",
          },
          {
            "approvalId": "<id>",
            "generationId": "id-3",
            "kind": "generation.approval-resolved",
            "resolution": {
              "choiceId": "allow",
              "kind": "chosen",
            },
            "threadId": "id-2",
          },
        ],
        "file": "hi",
        "history": [
          "user: write-git",
          "assistant(completed): Wrote .git/x",
        ],
        "reply": 204,
      },
      "deny": {
        "file": null,
        "history": [
          "user: write-git",
          "assistant(completed): Not written: The user denied this.",
        ],
        "reply": 204,
      },
    }
  `);
});

it('stops a turn waiting on an approval, clears the card, writes nothing, and runs the next turn', async () => {
  const { thread, workspace } = await agentThread('workspace-write');
  const generationId = await start(thread, 'write-git');
  await events.until((event) => event.kind === 'generation.approval-requested' && event.generationId === generationId);
  expect((await host.call('POST', `/api/threads/${thread.id}/stop`)).status).toBe(200);
  await events.finished(generationId);
  const next = await start(thread, 'hello');
  await events.finished(next);
  expect({ events: approvals(generationId), history: await history(thread), file: await written(workspace) }).toMatchInlineSnapshot(`
    {
      "events": [
        {
          "approval": {
            "approvalId": "<id>",
            "choices": [
              {
                "id": "allow",
                "label": "Allow",
              },
              {
                "id": "deny",
                "label": "Deny",
              },
            ],
            "summary": "Write .git/x: Claude requested permissions to edit ~/data/workspaces/id-1/.git/x which is a sensitive file.",
          },
          "generationId": "id-3",
          "kind": "generation.approval-requested",
          "threadId": "id-2",
        },
        {
          "approvalId": "<id>",
          "generationId": "id-3",
          "kind": "generation.approval-resolved",
          "resolution": {
            "kind": "cleared",
          },
          "threadId": "id-2",
        },
      ],
      "file": null,
      "history": [
        "user: write-git",
        "assistant(cancelled): ",
        "user: hello",
        "assistant(completed): Hello",
      ],
    }
  `);
});

it("runs a full-access agent's turn with Bash, no --restricted and no approval prompts", async () => {
  const { thread } = await agentThread('full');
  await events.finished(await start(thread, 'hello'));
  const log = await readFile(path.join(home, 'fake-claude', 'log.jsonl'), 'utf8');
  const launched = log.split('\n').flatMap((line) => (line.includes('"stdin":"hello"') ? [z.object({ args: z.array(z.string()) }).parse(JSON.parse(line)).args] : []));
  expect({ history: await history(thread), access: launched.map((args) => args.slice(args.indexOf('--disable-slash-commands') + 1)) }).toMatchInlineSnapshot(`
    {
      "access": [
        [
          "--tools",
          "Read,Glob,Grep,Edit,Write,Bash",
          "--permission-mode",
          "bypassPermissions",
          "--permission-prompts",
          "none",
          "--settings",
          "{"autoMemoryEnabled":false}",
          "--append-system-prompt-file",
          "/dev/fd/4",
          "--mcp-config",
          "/dev/fd/5",
          "--allowedTools",
          "mcp__orikami",
        ],
      ],
      "history": [
        "user: hello",
        "assistant(completed): Hello",
      ],
    }
  `);
});

it("shows a turn's rate-limit windows as live usage, and fails a refused turn as rate-limited with its reset time", async () => {
  const before = (await host.call('GET', '/api/plugins/provider-claude/usage')).body;
  const { thread } = await agentThread('read-only');
  await events.finished(await start(thread, 'rate-limit'));
  const after = (await host.call('GET', '/api/plugins/provider-claude/usage')).body;
  await events.finished(await start(thread, 'limited'));
  const hide = (value: unknown) => reparse(JSON.stringify(value).replaceAll(/"observedAt":"[^"]+"/g, '"observedAt":"<time>"').replaceAll(/"accountKey":"[0-9a-f]{64}"/g, '"accountKey":"<key>"'));
  expect({ before: hide(before), after: hide(after), history: await history(thread) }).toMatchInlineSnapshot(`
    {
      "after": {
        "persisted": true,
        "stale": false,
        "usage": {
          "accountKey": "<key>",
          "kind": "available",
          "observedAt": "<time>",
          "windows": [
            {
              "id": "five_hour",
              "kind": "session",
              "label": "Session",
              "resetsAt": "2026-11-27T14:10:00.000Z",
              "scope": {
                "kind": "account",
              },
              "usedPercent": 10,
              "windowMinutes": 300,
            },
            {
              "id": "seven_day",
              "kind": "weekly",
              "label": "Weekly",
              "resetsAt": "2026-11-28T06:00:00.000Z",
              "scope": {
                "kind": "account",
              },
              "usedPercent": 24,
              "windowMinutes": 10080,
            },
          ],
        },
      },
      "before": {
        "persisted": false,
        "stale": false,
        "usage": {
          "accountKey": "<key>",
          "kind": "unavailable",
          "observedAt": "<time>",
          "reason": "not-yet-observed",
        },
      },
      "history": [
        "user: rate-limit",
        "assistant(completed): Counted",
        "user: limited",
        "assistant(failed {"kind":"rate-limited","resetsAt":"2026-11-27T14:10:00.000Z","windowId":"five_hour"}): ",
      ],
    }
  `);
});

it("drops the old account's live usage once provider info sees another account", async () => {
  const { thread } = await agentThread('read-only');
  await events.finished(await start(thread, 'rate-limit'));
  const before = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-claude/usage')).body).usage;
  await mkdir(path.join(home, 'fake-claude'), { recursive: true });
  const other = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro', planTier: 'pro', email: 'other@example.com' };
  await writeFile(path.join(home, 'fake-claude', 'auth.json'), JSON.stringify(other));
  expect((await host.call('GET', '/api/plugins/provider-claude/info?refresh=1')).status).toBe(200);
  const after = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-claude/usage')).body).usage;
  expect({
    before: before.kind,
    after: { kind: after.kind, reason: after.kind === 'unavailable' ? after.reason : null, sameAccount: after.accountKey === before.accountKey },
  }).toEqual({ before: 'available', after: { kind: 'unavailable', reason: 'not-yet-observed', sameAccount: false } });
});

it('keeps the newest account when an older provider-info probe answers last', async () => {
  const { thread } = await agentThread('read-only');
  await events.finished(await start(thread, 'rate-limit'));
  const first = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-claude/usage')).body).usage;
  const state = path.join(home, 'fake-claude');
  await writeFile(path.join(state, 'hold-auth'), '');
  const older = host.call('GET', '/api/plugins/provider-claude/info?refresh=1');
  await vi.waitFor(() => readFile(path.join(state, 'auth-held')), { timeout: 5_000 });
  const other = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro', planTier: 'pro', email: 'other@example.com' };
  await writeFile(path.join(state, 'auth.json'), JSON.stringify(other));
  expect((await host.call('GET', '/api/plugins/provider-claude/info?refresh=1')).status).toBe(200);
  await rm(path.join(state, 'auth-held'));
  expect((await older).status).toBe(200);
  const usage = UsageResponse.parse((await host.call('GET', '/api/plugins/provider-claude/usage')).body).usage;
  expect({ kind: usage.kind, firstAccount: usage.accountKey === first.accountKey }).toEqual({ kind: 'unavailable', firstAccount: false });
});

it('checks managed policy again right before launch, and refuses a turn when a policy appeared during its auth check', async () => {
  const { thread } = await agentThread('read-only');
  await mkdir(path.join(home, 'fake-claude'), { recursive: true });
  await writeFile(path.join(home, 'fake-claude', 'policy-after-auths'), '1');
  await events.finished(await start(thread, 'hello'));
  const log = await readFile(path.join(home, 'fake-claude', 'log.jsonl'), 'utf8');
  const prompts = log.split('\n').filter((line) => line.includes('"stdin":"hello"'));
  const shown = (await history(thread)).map((line) => line.replaceAll(home, '$HOME'));
  expect({ history: shown, launched: prompts.length }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed {"kind":"access-not-supported","reason":"Claude Code server-managed settings are cached in $HOME/.claude/remote-settings.json."}): ",
      ],
      "launched": 0,
    }
  `);
});
