import { SendMessageResponse } from '@morrowbot/contracts';
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

async function sendAndWait(thread: { readonly id: string }, text: string): Promise<void> {
  const { generationId } = SendMessageResponse.parse((await codex.post(thread, text)).body);
  await codex.events.finished(generationId);
}

const logLength = async (): Promise<number> => (await codex.log()).length;
const methodsSince = async (from: number): Promise<string[]> => turnMethods((await codex.log()).slice(from));

it('holds read-only back, with the reason, when an administrator manages Codex', async () => {
  await codex.setState({ requirements: { featureRequirements: { shell_tool: true } } });
  const info = await codex.host.call('GET', '/api/plugins/provider-openai/info?refresh=1');
  const body = JSON.stringify(info.body);
  expect({ profiles: body.includes('"profiles":[]'), managed: body.includes('An administrator manages Codex') }).toEqual({ profiles: true, managed: true });
});

it('refuses before the prompt when Codex opens the thread on another model provider than the route it checked', async () => {
  await codex.setState({ openedProvider: 'elsewhere' });
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'hello');
  expect({ methods: turnMethods(await codex.log()), history: await codex.history(thread) }).toMatchInlineSnapshot(`
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

it('rechecks the route once the thread is open, and sends nothing when it changed in between', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'warm up');
  const other = await codex.thread(await codex.agent(), 'B');
  await codex.switchAfter(2, { account: { ...NATIVE.account, workspaceRouting: { ...NATIVE.account.workspaceRouting, backendOrigin: 'https://us.chatgpt.com' } } });
  const from = await logLength();
  await sendAndWait(other, 'hello');
  expect({ methods: await methodsSince(from), history: await codex.history(other) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed route-changed): ",
      ],
      "methods": [
        "thread/start",
        "thread/unsubscribe",
      ],
    }
  `);
});

it('resumes a thread Codex closed on its own instead of sending to it as loaded', async () => {
  const thread = await codex.thread(await codex.agent());
  await sendAndWait(thread, 'close-thread');
  const from = await logLength();
  await sendAndWait(thread, 'again');
  expect({ methods: await methodsSince(from), history: await codex.history(thread) }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: close-thread",
        "assistant(completed): Echo: close-thread",
        "user: again",
        "assistant(completed): Echo: again",
      ],
      "methods": [
        "thread/resume",
        "turn/start",
      ],
    }
  `);
});

it('after a workspace switch, a usage refresh does not serve the earlier workspace’s windows', async () => {
  const keys = new Map<string, string>();
  const usage = async (): Promise<unknown> => {
    const { body } = await codex.host.call('GET', '/api/plugins/provider-openai/usage?refresh=1');
    return JSON.parse(
      JSON.stringify(body)
        .replace(/"observedAt":"[^"]+"/g, '"observedAt":"<now>"')
        .replace(/\b[0-9a-f]{64}\b/g, (key) => keys.get(key) ?? keys.set(key, `account ${String(keys.size + 1)}`).get(key) ?? key),
    );
  };
  const before = await usage();
  const workspace2 = { ...NATIVE.account, workspaceRouting: { ...NATIVE.account.workspaceRouting, chatgptAccountId: 'ws-2' } };
  await codex.setState({ account: workspace2 });
  const unmatched = await usage();
  await codex.setState({ rateLimits: { ...NATIVE.rateLimits, accountId: 'ws-2' } });
  expect({ before, unmatched, matched: await usage() }).toMatchInlineSnapshot(`
    {
      "before": {
        "persisted": true,
        "stale": false,
        "usage": {
          "accountKey": "account 1",
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
      "matched": {
        "persisted": false,
        "stale": false,
        "usage": {
          "accountKey": "",
          "kind": "unavailable",
          "observedAt": "<now>",
          "reason": "not-yet-observed",
        },
      },
      "unmatched": {
        "persisted": false,
        "stale": false,
        "usage": {
          "accountKey": "",
          "kind": "unavailable",
          "observedAt": "<now>",
          "reason": "probe-failed",
        },
      },
    }
  `);
});

it('adopts the turn a turn/started named when Codex garbles the turn/start reply, and ends the daemon when nothing named it', async () => {
  const agent = await codex.agent();
  const [named, unnamed] = [await codex.thread(agent, 'A'), await codex.thread(agent, 'B')];
  await sendAndWait(named, 'garbled');
  const [pgid] = codex.daemonPgids();
  await sendAndWait(unnamed, 'garbled silent');
  const afterSilent = codex.daemonPgids();
  expect({ histories: [await codex.history(named), await codex.history(unnamed)], daemonEnded: !afterSilent.includes(pgid ?? -1) }).toMatchInlineSnapshot(`
    {
      "daemonEnded": true,
      "histories": [
        [
          "user: garbled",
          "assistant(completed): Echo: garbled",
        ],
        [
          "user: garbled silent",
          "assistant(interrupted): ",
        ],
      ],
    }
  `);
});
