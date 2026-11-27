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

/** The provider's info once the daemon a breach ended is gone (a request in flight across its exit is superseded). */
async function withheld(): Promise<unknown> {
  await until(() => agy.daemonPgids().length === 0);
  const info = await agy.host.call('GET', '/api/plugins/provider-antigravity/info?refresh=1');
  const body = JSON.stringify(info.body);
  return { profiles: /"profiles":\[\]/.test(body), breach: /ran |left its Default mode/.test(body) };
}

it('ends the daemon at once when agy reports an edit it never asked for, even though it ignores session/cancel, refuses the next turn, and starts no new daemon', async () => {
  const thread = await agy.thread(await agy.agent());
  await agy.send(thread, 'hello');
  const turn = await agy.start(thread, 'sneaky edit');
  await agy.events.finished(turn);
  const seen = { withheld: await withheld(), next: (await agy.post(thread, 'hello again')).body };
  expect({ steps: agy.steps(turn), cancels: await methods('session/cancel'), history: await agy.history(thread), ...seen, launches: (await agy.launches()).length, daemons: agy.daemonPgids().length }).toMatchInlineSnapshot(`
    {
      "cancels": 1,
      "daemons": 0,
      "history": [
        "user: hello",
        "assistant(completed): Echo: hello",
        "user: sneaky edit",
        "assistant(failed access-not-supported): ",
      ],
      "launches": 1,
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

it('refuses a turn, before its prompt, whose session leaves Default mode while MorrowBot sets it up', async () => {
  await agy.setState({ driftOnModel: true });
  const thread = await agy.thread(await agy.agent({ ...AGY, selection: { kind: 'model', id: 'fake-flash', choices: {} } }));
  await agy.send(thread, 'hello');
  expect({ history: await agy.history(thread), prompts: await methods('session/prompt'), withheld: await withheld() }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed access-not-supported): ",
      ],
      "prompts": 0,
      "withheld": {
        "breach": true,
        "profiles": true,
      },
    }
  `);
});

it("ends a session's turn before its prompt when agy reports a finished edit for it before MorrowBot holds the session", async () => {
  await agy.setState({ sneakOnNew: true });
  const thread = await agy.thread(await agy.agent());
  await agy.send(thread, 'hello');
  expect({ history: await agy.history(thread), prompts: await methods('session/prompt'), withheld: await withheld() }).toMatchInlineSnapshot(`
    {
      "history": [
        "user: hello",
        "assistant(failed access-not-supported): ",
      ],
      "prompts": 0,
      "withheld": {
        "breach": true,
        "profiles": true,
      },
    }
  `);
});

it('a breach in one turn fails another turn on the same daemon at once and withdraws its approval card; a late Allow allows nothing', async () => {
  await writeFile(path.join(agy.home, 'outside.txt'), 'secret plans');
  const agent = await agy.agent();
  const [reading, breaking] = [await agy.thread(agent, 'A'), await agy.thread(agent, 'B')];
  const read = await agy.start(reading, 'read-outside please');
  await agy.events.until((event) => event.kind === 'generation.approval-requested' && event.generationId === read);
  const approvalId = agy.events.received.flatMap((event) => (event.kind === 'generation.approval-requested' && event.generationId === read ? [event.approval.approvalId] : []))[0];
  const broken = await agy.start(breaking, 'sneaky edit');
  await agy.events.finished(broken);
  await agy.events.finished(read);
  const late = await agy.host.call('POST', `/api/threads/${reading.id}/approvals/${approvalId ?? 'missing'}`, { generationId: read, choiceId: 'allow' });
  const allowed = (await agy.log()).flatMap((entry) => (entry.method === 'permission-reply' ? [entry.params] : []));
  expect({ read: agy.steps(read), histories: [await agy.history(reading), await agy.history(breaking)], lateAllow: late.status, repliesToAgy: allowed }).toMatchInlineSnapshot(`
    {
      "histories": [
        [
          "user: read-outside please",
          "assistant(failed access-not-supported): ",
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
        "status: Antigravity (agy 1.5.18) ran "Edit File sneaky.txt" without asking. MorrowBot ended it and offers no Antigravity turns until the provider restarts.",
        "card resolved: {"kind":"cleared"}",
      ],
      "repliesToAgy": [
        {
          "choice": "cancelled",
          "tool": "read",
        },
      ],
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
