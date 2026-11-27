import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AGY, type AgyFixture, startAgyFixture } from '../../testing/agy-fixture.ts';
import { until } from '../../testing/daemon-fixture.ts';

let agy: AgyFixture;

beforeEach(async () => {
  agy = await startAgyFixture();
});

afterEach(async () => {
  await agy.close();
  expect(agy.host.errors).toEqual([]);
});

const methods = async (method: string): Promise<number> => (await agy.log()).filter((entry) => entry.method === method).length;

async function withheld(): Promise<unknown> {
  const info = await agy.host.call('GET', '/api/plugins/provider-antigravity/info?refresh=1');
  const body = JSON.stringify(info.body);
  return { profiles: /"profiles":\[\]/.test(body), breach: /ran |left its Default mode/.test(body) };
}

it('ends the daemon at once when agy reports an edit it never asked for, even though it ignores session/cancel, and refuses the next turn', async () => {
  const thread = await agy.thread(await agy.agent());
  await agy.send(thread, 'hello');
  const [before] = agy.daemonPgids();
  const turn = await agy.start(thread, 'sneaky edit');
  await agy.events.finished(turn);
  await until(() => agy.daemonPgids()[0] !== before);
  const next = await agy.post(thread, 'hello again');
  expect({ steps: agy.steps(turn), cancels: await methods('session/cancel'), history: await agy.history(thread), withheld: await withheld(), next: next.body }).toMatchInlineSnapshot(`
    {
      "cancels": 1,
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: sneaky edit",
        "assistant(failed access-not-supported): ",
      ],
      "next": {
        "error": {
          "kind": "conflict",
          "message": "Antigravity (agy 1.5.18) ran "Edit File sneaky.txt" without asking. MorrowBot ended it and offers no Antigravity turns until the provider restarts.",
        },
      },
      "steps": [
        "tool-start Edit: {"title":"File sneaky.txt"}",
        "tool-end: ok",
        "status: Antigravity (agy 1.5.18) ran "Edit File sneaky.txt" without asking. MorrowBot ended it and offers no Antigravity turns until the provider restarts.",
      ],
      "withheld": {
        "breach": true,
        "profiles": true,
      },
    }
  `);
});

it('ends the daemon at once when agy leaves Default mode during a turn', async () => {
  const thread = await agy.thread(await agy.agent());
  const turn = await agy.start(thread, 'switch-mode now');
  await agy.events.finished(turn);
  expect({ steps: agy.steps(turn), history: await agy.history(thread), withheld: await withheld() }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: switch-mode now",
        "assistant(failed access-not-supported): ",
      ],
      "steps": [
        "status: Antigravity (agy 1.5.18) left its Default mode for "auto". MorrowBot ended it and offers no Antigravity turns until the provider restarts.",
      ],
      "withheld": {
        "breach": true,
        "profiles": true,
      },
    }
  `);
});

it('refuses a turn whose session leaves Default mode while MorrowBot sets it up', async () => {
  await agy.setState({ driftOnModel: true });
  const thread = await agy.thread(await agy.agent({ ...AGY, selection: { kind: 'model', id: 'fake-flash', choices: {} } }));
  await agy.send(thread, 'hello');
  expect({ history: await agy.history(thread), withheld: await withheld() }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed access-not-supported): ",
      ],
      "withheld": {
        "breach": true,
        "profiles": true,
      },
    }
  `);
});

it('a breach in one turn withdraws the open approval card of another turn on the same daemon, which ends interrupted', async () => {
  await writeFile(path.join(agy.home, 'outside.txt'), 'secret plans');
  const agent = await agy.agent();
  const [reading, breaking] = [await agy.thread(agent, 'A'), await agy.thread(agent, 'B')];
  const read = await agy.start(reading, 'read-outside please');
  await agy.events.until((event) => event.kind === 'generation.approval-requested' && event.generationId === read);
  const broken = await agy.start(breaking, 'sneaky edit');
  await agy.events.finished(broken);
  await agy.events.finished(read);
  const late = await agy.host.call('POST', `/api/threads/${reading.id}/approvals/none`, { generationId: read, choiceId: 'allow' });
  const allowed = (await agy.log()).filter((entry) => entry.method === 'permission-reply' || entry.method === 'client-reply');
  expect({ read: agy.steps(read), histories: [await agy.history(reading), await agy.history(breaking)], lateAllow: late.status, repliesToAgy: allowed }).toMatchInlineSnapshot(`
    {
      "histories": [
        [
          "user: read-outside please",
          "assistant(interrupted): ",
        ],
        [
          "user: sneaky edit",
          "assistant(failed access-not-supported): ",
        ],
      ],
      "lateAllow": 404,
      "read": [
        "tool-start Read: {"title":"File outside.txt"}",
        "card: Antigravity wants to read ~/outside.txt [allow, deny]",
        "card resolved: {"kind":"cleared"}",
      ],
      "repliesToAgy": [],
    }
  `);
});

it("refuses a turn in a workspace with agy's own customization folder, and in one below a git root that has one", async () => {
  const agent = await agy.agent();
  const thread = await agy.thread(agent);
  const workspace = path.join(agy.home, 'data', 'workspaces', agent.id);
  await mkdir(path.join(workspace, '.agents'), { recursive: true });
  await agy.send(thread, 'hello');
  const other = await agy.agent();
  const below = await agy.thread(other);
  await mkdir(path.join(agy.home, 'data', '.git'), { recursive: true });
  await mkdir(path.join(agy.home, 'data', '_agent'), { recursive: true });
  await mkdir(path.join(agy.home, 'data', 'workspaces', other.id), { recursive: true });
  await agy.send(below, 'hello');
  const reason = async (of: { readonly id: string }): Promise<string | undefined> =>
    JSON.stringify((await agy.host.call('GET', `/api/threads/${of.id}/messages`)).body).match(/Antigravity runs the hooks in [^ ]*/)?.[0];
  expect({ sessions: await methods('session/new'), histories: [await agy.history(thread), await agy.history(below)], reasons: [await reason(thread), await reason(below)] }).toMatchInlineSnapshot(`
    {
      "histories": [
        [
          "user: hello",
          "assistant(failed access-not-supported): ",
        ],
        [
          "user: hello",
          "assistant(failed access-not-supported): ",
        ],
      ],
      "reasons": [
        "Antigravity runs the hooks in ~/data/workspaces/id-1/.agents",
        "Antigravity runs the hooks in ~/data/_agent",
      ],
      "sessions": 0,
    }
  `);
});

it('runs a turn when the only customization folder is above the git root', async () => {
  const agent = await agy.agent();
  const thread = await agy.thread(agent);
  const workspace = path.join(agy.home, 'data', 'workspaces', agent.id);
  await mkdir(path.join(workspace, '.git'), { recursive: true });
  await mkdir(path.join(agy.home, '.agents'), { recursive: true });
  await agy.send(thread, 'hello');
  expect(await agy.history(thread)).toMatchInlineSnapshot(`
    [
      "user: hello",
      "assistant(completed): Echo: hello",
    ]
  `);
});
