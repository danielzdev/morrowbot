import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProviderBinding } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { AGY, type AgyFixture, startAgyFixture } from '../../testing/agy-fixture.ts';
import { isRunning, until } from '../../testing/daemon-fixture.ts';

let agy: AgyFixture | undefined;

afterEach(async () => {
  if (agy === undefined) return;
  await agy.close();
  expect(agy.host.errors).toEqual([]);
  agy = undefined;
});

const FULL: Extract<ProviderBinding, { kind: 'bound' }> = { ...AGY, access: 'full' };

it('a full-access turn runs the command agy asks for without a card, and the daemon stays up for a read-only turn', async () => {
  const fixture = (agy = await startAgyFixture());
  const agent = await fixture.agent(FULL);
  const thread = await fixture.thread(agent);
  const turn = await fixture.start(thread, 'command');
  await fixture.events.finished(turn);
  const workspace = path.join(fixture.home, 'data', 'workspaces', agent.id);
  const readOnly = await fixture.thread(await fixture.agent());
  await fixture.send(readOnly, 'hello');
  const log = await fixture.log();
  expect({
    ran: existsSync(path.join(workspace, 'ran.txt')),
    steps: fixture.steps(turn),
    permission: log.filter((entry) => entry.method === 'permission-reply').map((entry) => entry.params),
    launches: (await fixture.launches()).length,
    histories: [await fixture.history(thread), await fixture.history(readOnly)],
  }).toMatchInlineSnapshot(`
    {
      "histories": [
        [
          "user: command",
          "assistant(completed): ran it",
        ],
        [
          "user: hello",
          "assistant(completed): Echo: hello",
        ],
      ],
      "launches": 1,
      "permission": [
        {
          "choice": "allow",
          "tool": "execute",
        },
      ],
      "ran": true,
      "steps": [
        "tool-start Shell: {"title":"touch ran.txt"}",
        "tool-end: ok",
      ],
    }
  `);
});

it('Stop on a full-access turn sends session/cancel, and the command agy was running has ended before the host closes', async () => {
  const fixture = (agy = await startAgyFixture());
  const thread = await fixture.thread(await fixture.agent(FULL));
  const turn = await fixture.start(thread, 'spawn then stall');
  const [spawned] = (await fixture.logged('spawned', 1)).flatMap((entry) =>
    entry.method === 'spawned' && typeof entry.params === 'object' && entry.params !== null && 'pid' in entry.params && typeof entry.params.pid === 'number' ? [entry.params.pid] : [],
  );
  const runningBefore = spawned !== undefined && isRunning(spawned);
  const stop = await fixture.host.call('POST', `/api/threads/${thread.id}/stop`);
  await fixture.events.finished(turn);
  await until(() => spawned !== undefined && !isRunning(spawned));
  const log = await fixture.logged('session/close', 2);
  expect({
    stop: stop.status,
    runningBefore,
    runningAfter: spawned !== undefined && isRunning(spawned),
    sent: log.filter((entry) => entry.method === 'session/prompt' || entry.method === 'session/cancel').map((entry) => entry.method),
    history: await fixture.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: spawn then stall",
        "assistant(cancelled): ",
      ],
      "runningAfter": false,
      "runningBefore": true,
      "sent": [
        "session/prompt",
        "session/cancel",
      ],
      "stop": 200,
    }
  `);
});
