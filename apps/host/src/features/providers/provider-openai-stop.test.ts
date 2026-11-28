import { StartedSend } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { type CodexFixture, startCodexFixture, turnMethods } from '../../testing/codex-fixture.ts';
import { DEFAULT_PLUGIN_TIMEOUTS } from '../../testing/test-host.ts';

let codex: CodexFixture | undefined;

afterEach(async () => {
  if (codex === undefined) return;
  await codex.close();
  expect(codex.host.errors).toEqual([]);
  codex = undefined;
});

async function start(fixture: CodexFixture, thread: { readonly id: string }, text: string): Promise<string> {
  return StartedSend.parse((await fixture.post(thread, text)).body).generationId;
}


const finishedCount = (fixture: CodexFixture, generationId: string): number =>
  fixture.turnEvents(generationId).filter((event) => event.kind === 'generation.finished').length;

it('Stop sends turn/interrupt for that turn only, and the other turn keeps running on the same daemon', async () => {
  const fixture = (codex = await startCodexFixture());
  const agent = await fixture.agent();
  const [stopped, running] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B')];
  await start(fixture, stopped, 'stall');
  const other = await start(fixture, running, 'stall');
  await fixture.logged('turn/start', 2);
  const pgids = fixture.daemonPgids();
  const from = (await fixture.log()).length;
  const reply = await fixture.host.call('POST', `/api/threads/${stopped.id}/stop`);
  const afterStop = { stillRunning: finishedCount(fixture, other) === 0, samePgid: fixture.daemonPgids().join() === pgids.join() };
  await fixture.host.call('POST', `/api/threads/${running.id}/stop`);
  await fixture.events.finished(other);
  expect({ status: reply.status, sent: turnMethods((await fixture.log()).slice(from)), afterStop, histories: [await fixture.history(stopped), await fixture.history(running)] })
    .toMatchInlineSnapshot(`
      {
        "afterStop": {
          "samePgid": true,
          "stillRunning": true,
        },
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
        "sent": [
          "turn/interrupt",
          "turn/interrupt",
        ],
        "status": 200,
      }
    `);
});

it('a daemon that ignores interrupt is killed after turnStopMs, both its turns settle once as interrupted, and a new daemon serves the next turn', async () => {
  const fixture = (codex = await startCodexFixture({ timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, turnStopMs: 300 } }));
  const agent = await fixture.agent();
  const [ignoring, sharing] = [await fixture.thread(agent, 'A'), await fixture.thread(agent, 'B')];
  const first = await start(fixture, ignoring, 'ignore-interrupt');
  const second = await start(fixture, sharing, 'stall');
  await fixture.logged('turn/start', 2);
  const [pgid] = fixture.daemonPgids();
  await fixture.host.call('POST', `/api/threads/${ignoring.id}/stop`);
  await fixture.events.finished(first);
  await fixture.events.finished(second);
  const from = (await fixture.log()).length;
  const refused = (await fixture.post(sharing, 'after')).body;
  const next = StartedSend.parse((await fixture.post(sharing, 'after', { kind: 'continue-existing' })).body).generationId;
  await fixture.events.finished(next);
  const [replaced] = fixture.daemonPgids();
  expect({
    refused,
    finishedOnce: [finishedCount(fixture, first), finishedCount(fixture, second)],
    newDaemon: replaced !== undefined && replaced !== pgid,
    daemons: fixture.daemonPgids().length,
    nextSent: turnMethods((await fixture.log()).slice(from)),
    histories: [await fixture.history(ignoring), await fixture.history(sharing)],
  }).toMatchInlineSnapshot(`
    {
      "daemons": 1,
      "finishedOnce": [
        1,
        1,
      ],
      "histories": [
        [
          "user: ignore-interrupt",
          "assistant(interrupted): ",
        ],
        [
          "user: stall",
          "assistant(interrupted): ",
          "user: after",
          "assistant(completed): Echo: after",
        ],
      ],
      "newDaemon": true,
      "nextSent": [
        "thread/resume",
        "turn/start",
      ],
      "refused": {
        "error": {
          "kind": "session-choice-required",
          "message": "The last turn in the saved session did not finish. Continue it anyway, or start a new session seeded from this thread.",
          "reason": "diverged",
        },
      },
    }
  `);
});
