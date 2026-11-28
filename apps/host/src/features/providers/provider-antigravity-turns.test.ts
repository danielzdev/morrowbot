import { afterEach, expect, it } from 'vitest';
import { AGY, type AgyFixture, FAKE_AGY, startAgyFixture, turnMethods } from '../../testing/agy-fixture.ts';
import { DEFAULT_PLUGIN_TIMEOUTS } from '../../testing/test-host.ts';

let agy: AgyFixture | undefined;

afterEach(async () => {
  if (agy === undefined) return;
  await agy.close();
  expect(agy.host.errors).toEqual([]);
  agy = undefined;
});


function redact(fixture: AgyFixture, value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(FAKE_AGY, '<fake-agy>').replaceAll(fixture.home, '$HOME').replace(/sess-\d+-/g, 'sess-<pid>-'));
}

/** Each request as `method session`, sessions lettered A, B… in the order they first appear (two turns open theirs in either order). */
function bySession(entries: readonly { readonly method: string; readonly params: unknown }[]): string[] {
  const letters = new Map<string, string>();
  return entries.map((entry) => {
    const id = JSON.stringify(entry.params).match(/sess-[\w-]+/)?.[0] ?? '';
    if (!letters.has(id)) letters.set(id, String.fromCharCode(65 + letters.size));
    return `${entry.method} ${letters.get(id) ?? ''}`;
  });
}

it('Stop sends session/cancel for that turn only, and the other turn keeps running on the same daemon', async () => {
  const fixture = (agy = await startAgyFixture());
  const agent = await fixture.agent();
  const [stopped, running] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B')];
  await fixture.start(stopped, 'stall');
  const other = await fixture.start(running, 'stall');
  await fixture.logged('session/prompt', 2);
  const pgids = fixture.daemonPgids();
  const from = (await fixture.log()).length;
  const reply = await fixture.host.call('POST', `/api/threads/${stopped.id}/stop`);
  const stillRunning = fixture.turnEvents(other).every((event) => event.kind !== 'generation.finished');
  await fixture.host.call('POST', `/api/threads/${running.id}/stop`);
  await fixture.events.finished(other);
  await fixture.logged('session/close', 2);
  expect(
    redact(fixture, {
      status: reply.status,
      stillRunning,
      samePgid: fixture.daemonPgids().join() === pgids.join(),
      sent: bySession((await fixture.log()).slice(from)),
      histories: [await fixture.history(stopped), await fixture.history(running)],
    }),
  ).toMatchInlineSnapshot(`
    {
      "histories": [
        [
          "user: stall",
          "assistant(cancelled): ",
        ],
        [
          "user: stall",
          "assistant(cancelled): ",
        ],
      ],
      "samePgid": true,
      "sent": [
        "session/cancel A",
        "session/close A",
        "session/cancel B",
        "session/close B",
      ],
      "status": 200,
      "stillRunning": true,
    }
  `);
});

it('a daemon that ignores session/cancel is killed after turnStopMs, the turn ends interrupted, and a new daemon serves the next turn', async () => {
  const fixture = (agy = await startAgyFixture({ timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 300 } }));
  const thread = await fixture.thread(await fixture.agent());
  const first = await fixture.start(thread, 'ignore-cancel');
  await fixture.logged('session/prompt', 1);
  const [pgid] = fixture.daemonPgids();
  await fixture.host.call('POST', `/api/threads/${thread.id}/stop`);
  await fixture.events.finished(first);
  await fixture.send(thread, 'after');
  const [replaced] = fixture.daemonPgids();
  expect({ newDaemon: replaced !== undefined && replaced !== pgid, daemons: fixture.daemonPgids().length, launches: (await fixture.launches()).length, history: await fixture.history(thread) })
    .toMatchInlineSnapshot(`
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
      }
    `);
});

it('a signed-out agy fails the turn as signed-out, and provider-info then offers the login command', async () => {
  const fixture = (agy = await startAgyFixture());
  const thread = await fixture.thread(await fixture.agent());
  await fixture.setState({ signedOut: true });
  await fixture.send(thread, 'hello');
  const info = await fixture.host.call('GET', '/api/plugins/provider-antigravity/info?refresh=1');
  expect(redact(fixture, { history: await fixture.history(thread), info: info.body })).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed signed-out): ",
      ],
      "info": {
        "info": {
          "kind": "signed-out",
          "signIn": {
            "argv": [
              "<fake-agy>",
              "acp",
              "--gemini-dir",
              "$HOME/data/plugin-data/provider-antigravity/gemini",
              "--login",
            ],
            "kind": "run-in-terminal",
          },
        },
      },
    }
  `);
});

it('a spent quota fails the turn as rate-limited', async () => {
  const fixture = (agy = await startAgyFixture());
  const thread = await fixture.thread(await fixture.agent());
  await fixture.send(thread, 'quota');
  expect(await fixture.history(thread)).toMatchInlineSnapshot(`
    [
      "user: quota",
      "assistant(failed rate-limited): ",
    ]
  `);
});

it('sets the picked model and thinking level on each new session, and refuses a model agy does not have', async () => {
  const fixture = (agy = await startAgyFixture());
  await fixture.send(await fixture.thread(await fixture.agent()), 'hello');
  const flash = await fixture.thread(await fixture.agent({ ...AGY, selection: { kind: 'model', id: 'fake-flash', choices: { thought_level: 'minimal' } } }));
  const from = (await fixture.logged('session/close', 1)).length;
  await fixture.send(flash, 'hello');
  const log = (await fixture.logged('session/close', 2)).slice(from);
  const sent = turnMethods(log).filter((method) => method !== 'client-reply');
  const configured = log.filter((entry) => entry.method === 'session/set_config_option').map((entry) => entry.params);
  const gone = await fixture.agent({ ...AGY, selection: { kind: 'model', id: 'fake-gone', choices: {} } });
  const refused = await fixture.thread(gone);
  const reply = await fixture.send(refused, 'hello');
  expect(redact(fixture, { sent, configured, history: await fixture.history(flash), refused: reply.status === 202 ? await fixture.history(refused) : reply.body })).toMatchInlineSnapshot(`
    {
      "configured": [
        {
          "configId": "model",
          "sessionId": "sess-<pid>-2",
          "value": "fake-flash",
        },
        {
          "configId": "thought_level",
          "sessionId": "sess-<pid>-2",
          "value": "minimal",
        },
      ],
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
      ],
      "refused": [
        "user: hello",
        "assistant(failed invalid-model): ",
      ],
      "sent": [
        "session/new",
        "session/set_config_option",
        "session/set_config_option",
        "session/prompt",
        "session/close",
      ],
    }
  `);
});
