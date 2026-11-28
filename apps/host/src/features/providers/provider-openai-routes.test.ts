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

const CUSTOM = { config: { ...NATIVE.config, openai_base_url: 'https://api.openai.com/v1' } };

async function sendAndWait(thread: { readonly id: string }, text: string, sessionChoice?: { readonly kind: string }): Promise<unknown> {
  const reply = await codex.post(thread, text, sessionChoice);
  const sent = StartedSend.safeParse(reply.body);
  if (!sent.success) return { status: reply.status, body: reply.body };
  await codex.events.finished(sent.data.generationId);
  return reply.status;
}

async function methodsSince(from: number): Promise<string[]> {
  return turnMethods((await codex.log()).slice(from));
}

const logLength = async (): Promise<number> => (await codex.log()).length;

it('native → custom runs stateless ephemeral turns with no prompt; custom → native asks for a seeded session, which works', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'native one');
  await codex.setState(CUSTOM);
  const customFrom = await logLength();
  const custom = [await sendAndWait(thread, 'custom one'), await sendAndWait(thread, 'custom two')];
  const customLog = (await codex.logged('thread/unsubscribe', 2)).slice(customFrom);
  const customStarts = customLog.filter((entry) => entry.method === 'thread/start').map((entry) => entry.params);
  const customMethods = turnMethods(customLog);
  await codex.setState({ config: NATIVE.config });
  const back = await sendAndWait(thread, 'native again');
  const seeded = await sendAndWait(thread, 'native again', { kind: 'new-seeded' });
  expect({ custom, customMethods, ephemeral: customStarts.map((params) => JSON.stringify(params).includes('"ephemeral":true')), back, seeded, history: await codex.history(thread) })
    .toMatchInlineSnapshot(`
      {
        "back": {
          "body": {
            "error": {
              "kind": "session-choice-required",
              "message": "This thread has history the provider has not seen. Start a new session seeded from this thread.",
              "reason": "unseeded-history",
            },
          },
          "status": 409,
        },
        "custom": [
          202,
          202,
        ],
        "customMethods": [
          "thread/start",
          "turn/start",
          "thread/unsubscribe",
          "thread/start",
          "turn/start",
          "thread/unsubscribe",
        ],
        "ephemeral": [
          true,
          true,
        ],
        "history": [
          "user: native one",
          "assistant(completed): Echo: native one",
          "user: custom one",
          "assistant(completed): Echo: custom one",
          "user: custom two",
          "assistant(completed): Echo: custom two",
          "user: native again",
          "assistant(completed): Echo: native again",
        ],
        "seeded": 202,
      }
    `);
});

it('a route change between route-info and the turn ends route-changed with nothing sent, and leaves another turn running', async () => {
  const agent = await codex.agent();
  const [stalled, changed] = [await codex.thread(agent, 'A'), await codex.thread(agent, 'B')];
  const running = StartedSend.parse((await codex.post(stalled, 'stall')).body).generationId;
  await codex.logged('turn/start', 1);
  await codex.switchAfter(1, { config: { ...NATIVE.config, chatgpt_base_url: 'https://gateway.example.com/backend-api/' } });
  const from = await logLength();
  const result = await sendAndWait(changed, 'hello');
  const sent = await methodsSince(from);
  const stillRunning = !codex.turnEvents(running).some((event) => event.kind === 'generation.finished');
  await codex.host.call('POST', `/api/threads/${stalled.id}/stop`);
  expect({ result, sent, stillRunning, history: await codex.history(changed) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed route-changed): ",
      ],
      "result": 202,
      "sent": [],
      "stillRunning": true,
    }
  `);
});

it('a workspace switch with unchanged config ends account-changed; a new backend origin ends route-changed; a logout ends signed-out', async () => {
  const agent = await codex.agent();
  const otherWorkspace = { ...NATIVE.account, workspaceRouting: { ...NATIVE.account.workspaceRouting, chatgptAccountId: 'ws-2' } };
  const movedOrigin = { ...NATIVE.account, workspaceRouting: { ...NATIVE.account.workspaceRouting, backendOrigin: 'https://us.chatgpt.com' } };
  const signedOut = { account: null, userId: null, requiresOpenaiAuth: true, workspaceRouting: null };
  const ended: unknown[] = [];
  for (const [name, account] of [['workspace', otherWorkspace], ['origin', movedOrigin], ['logout', signedOut]] as const) {
    await codex.setState({ account: NATIVE.account });
    await codex.host.call('GET', '/api/plugins/provider-openai/info?refresh=1');
    const thread = await codex.thread(agent, name);
    await sendAndWait(thread, 'before');
    await codex.switchAfter(1, { account });
    const from = await logLength();
    await sendAndWait(thread, 'switch');
    ended.push({ name, sent: await methodsSince(from), history: await codex.history(thread) });
  }
  expect(ended).toMatchInlineSnapshot(`
    [
      {
        "history": [
          "user: before",
          "assistant(completed): Echo: before",
          "user: switch",
          "assistant(failed account-changed): ",
        ],
        "name": "workspace",
        "sent": [],
      },
      {
        "history": [
          "user: before",
          "assistant(completed): Echo: before",
          "user: switch",
          "assistant(failed route-changed): ",
        ],
        "name": "origin",
        "sent": [],
      },
      {
        "history": [
          "user: before",
          "assistant(completed): Echo: before",
          "user: switch",
          "assistant(failed signed-out): ",
        ],
        "name": "logout",
        "sent": [],
      },
    ]
  `);
});

it('a failed discovery rejects the send with nothing written; a null workspace runs stateless with no session prompt', async () => {
  const thread = await codex.thread(await codex.agent());
  await codex.host.call('GET', '/api/plugins/provider-openai/info');
  await codex.setState({ accountError: 'network unreachable' });
  const from = await logLength();
  const failed = await sendAndWait(thread, 'hello');
  const sentAfterFailure = await methodsSince(from);
  await codex.setState({ accountError: null, account: { ...NATIVE.account, workspaceRouting: null } });
  const unknown = [await sendAndWait(thread, 'one'), await sendAndWait(thread, 'two'), await sendAndWait(thread, 'three')];
  expect({ failed, sentAfterFailure, unknown, history: await codex.history(thread) }).toMatchInlineSnapshot(`
    {
      "failed": {
        "body": {
          "error": {
            "kind": "provider-unavailable",
            "message": "The provider could not say which account it uses. Try again.",
            "reason": "route-info-failed",
          },
        },
        "status": 503,
      },
      "history": [
        "user: one",
        "assistant(completed): Echo: one",
        "user: two",
        "assistant(completed): Echo: two",
        "user: three",
        "assistant(completed): Echo: three",
      ],
      "sentAfterFailure": [],
      "unknown": [
        202,
        202,
        202,
      ],
    }
  `);
});

it('publishes plan usage only on the native route, and refuses a quota answer for another workspace', async () => {
  const usage = async (): Promise<unknown> =>
    JSON.parse(JSON.stringify((await codex.host.call('GET', '/api/plugins/provider-openai/usage?refresh=1')).body).replace(/"observedAt":"[^"]+"/g, '"observedAt":"<now>"'));
  const native = await usage();
  const at = (usedPercent: number, accountId: string | null) => ({ rateLimits: { ...NATIVE.rateLimits, rateLimits: { ...NATIVE.rateLimits.rateLimits, primary: { ...NATIVE.rateLimits.rateLimits.primary, usedPercent } }, accountId } });
  await codex.setState(at(40, 'ws-other'));
  const mismatched = await usage();
  await codex.setState(at(70, null));
  const unnamed = await usage();
  await codex.setState(CUSTOM);
  await codex.host.call('GET', '/api/plugins/provider-openai/info?refresh=1');
  const custom = await usage();
  expect({ native, mismatched, unnamed, custom }).toMatchInlineSnapshot(`
    {
      "custom": {
        "persisted": false,
        "stale": false,
        "usage": {
          "accountKey": "",
          "kind": "unavailable",
          "observedAt": "<now>",
          "reason": "api-key-route",
        },
      },
      "mismatched": {
        "persisted": true,
        "stale": true,
        "usage": {
          "accountKey": "a0c48003fdf8d511494d2dfe8e77a16ebb2a29aa8eeb891499fd030b013a6e15",
          "kind": "available",
          "observedAt": "<now>",
          "windows": [
            {
              "id": "primary",
              "kind": "weekly",
              "label": "Weekly",
              "resetsAt": "2026-11-29T20:30:57.000Z",
              "scope": {
                "kind": "account",
              },
              "usedPercent": 5,
              "windowMinutes": 10080,
            },
          ],
        },
      },
      "native": {
        "persisted": true,
        "stale": false,
        "usage": {
          "accountKey": "a0c48003fdf8d511494d2dfe8e77a16ebb2a29aa8eeb891499fd030b013a6e15",
          "kind": "available",
          "observedAt": "<now>",
          "windows": [
            {
              "id": "primary",
              "kind": "weekly",
              "label": "Weekly",
              "resetsAt": "2026-11-29T20:30:57.000Z",
              "scope": {
                "kind": "account",
              },
              "usedPercent": 5,
              "windowMinutes": 10080,
            },
          ],
        },
      },
      "unnamed": {
        "persisted": true,
        "stale": false,
        "usage": {
          "accountKey": "a0c48003fdf8d511494d2dfe8e77a16ebb2a29aa8eeb891499fd030b013a6e15",
          "kind": "available",
          "observedAt": "<now>",
          "windows": [
            {
              "id": "primary",
              "kind": "weekly",
              "label": "Weekly",
              "resetsAt": "2026-11-29T20:30:57.000Z",
              "scope": {
                "kind": "account",
              },
              "usedPercent": 70,
              "windowMinutes": 10080,
            },
          ],
        },
      },
    }
  `);
});

it('a rate-limit notification during a native turn reads usage again and sends it with the turn; a usage-limit failure is rate-limited', async () => {
  const thread = await codex.thread(await codex.agent());
  const reply = await codex.post(thread, 'hint');
  const { generationId } = StartedSend.parse(reply.body);
  await codex.events.finished(generationId);
  const updates = codex.events.received.filter((event) => event.kind === 'usage.updated');
  await sendAndWait(thread, 'fail-limit');
  expect({ updates: updates.length > 0, history: await codex.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hint",
        "assistant(completed): Echo: hint",
        "user: fail-limit",
        "assistant(failed rate-limited): ",
      ],
      "updates": true,
    }
  `);
});
