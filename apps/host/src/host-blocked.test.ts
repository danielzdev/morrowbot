import { StartedSend, StopGenerationResponse, ThreadState } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { systemProbe, type ProcessProbe } from './features/plugins/index.ts';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** The real probe, except that while `stuck` every group looks alive with an unreadable leader. */
function stickyProbe(): { probe: ProcessProbe; stick: () => void } {
  let stuck = false;
  return {
    probe: {
      signalGroup: (pgid) => (stuck ? 'denied' : systemProbe.signalGroup(pgid)),
      leader: async (pid) => (stuck ? { kind: 'unreadable' } : systemProbe.leader(pid)),
      bootId: () => systemProbe.bootId(),
    },
    stick: () => {
      stuck = true;
    },
  };
}

function scrub(value: unknown): unknown {
  return JSON.parse(hidePid(JSON.stringify(value)));
}

async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 20));
}

it('answers Stop once a group is blocked, keeps the thread busy, and frees it on Release anyway after 60 s', async () => {
  const { probe, stick } = stickyProbe();
  let skipped = 0;
  chat = await startChatFixture({ probe, clock: { now: () => new Date().toISOString(), monotonic: () => performance.now() + skipped } });
  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  const sent = StartedSend.parse((await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'sleep' })).body);
  const groups = chat.host.host.plugins.groups;
  await until(() => groups.groupsOf(new Set([sent.generationId])).length > 0);
  stick();
  const stopped = await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  const state = ThreadState.parse((await chat.host.call('GET', `/api/threads/${thread.id}/state`)).body);
  const [blocked] = state.blockedGroups;
  if (blocked === undefined) throw new Error('no blocked group');
  const busy = await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'after' });
  const early = await chat.host.call('POST', `/api/child-groups/${blocked.regId}/release`);
  skipped = 61_000;
  const released = await chat.host.call('POST', `/api/child-groups/${blocked.regId}/release`);
  const next = await chat.send(thread, 'after');
  expect({
    stopped: scrub(StopGenerationResponse.parse(stopped.body)),
    activeTurn: state.activeTurn,
    blocked: state.blockedGroups.map((group) => ({ pluginId: group.pluginId, kind: group.kind, releasable: group.releasable })),
    busy: busy.status,
    early: early.body,
    released: released.body,
    next: next.status,
    history: await chat.history(thread),
  }).toMatchInlineSnapshot(`
    {
      "activeTurn": null,
      "blocked": [
        {
          "kind": "turn",
          "pluginId": "echo",
          "releasable": false,
        },
      ],
      "busy": 202,
      "early": {
        "error": {
          "kind": "conflict",
          "message": "Release anyway is offered after 60 seconds blocked.",
        },
      },
      "history": [
        "user: sleep",
        "assistant(cancelled): hello from pid <pid>:",
        "user: after",
        "assistant(completed): hello from pid <pid>: after",
      ],
      "next": 202,
      "released": {
        "released": true,
      },
      "stopped": {
        "kind": "stopped",
        "message": {
          "attachments": [],
          "createdAt": "2026-01-01T00:00:04.000Z",
          "id": "id-5",
          "kind": "assistant",
          "outcome": {
            "kind": "cancelled",
          },
          "text": "hello from pid <pid>:",
          "threadId": "id-2",
        },
      },
    }
  `);
});
