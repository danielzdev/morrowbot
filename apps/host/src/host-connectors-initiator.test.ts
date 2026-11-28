import path from 'node:path';
import { QueuedSend, StartedSend, type Thread } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { stdioSetup } from './testing/connector-kit.ts';
import { startMemberKit, type MemberKit } from './testing/member-kit.ts';

let kit: MemberKit | undefined;
afterEach(async () => {
  await kit?.close();
  expect(kit?.chat.host.errors ?? []).toEqual([]);
  kit = undefined;
});

const ECHO_CALL = (text: string): string => `host-tool notes__echo {"text":"${text}"}`;

/** The thread's last reply, as the echo fixture wrote the tool's answer into it. */
async function lastReply(live: MemberKit, thread: Thread): Promise<string | undefined> {
  return (await live.chat.history(thread)).at(-1);
}

it('on an agent shared with a member, the owner’s turns use its connectors and the member’s turns never do', async () => {
  kit = await startMemberKit();
  const live = kit;
  const shared = await live.named('Shared');
  const plain = await live.named('Plain');
  const created = await live.chat.host.call('POST', '/api/connectors', { label: 'Notes', setup: stdioSetup('work', path.join(live.chat.dataDir, 'log')), scope: { mode: 'all', agentIds: [] } });
  expect(created.status).toBe(201);
  const guest = await live.join('Guest', { kind: 'scoped', agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });

  const memberSend = async (thread: Thread, text: string): Promise<void> => {
    const { generationId } = StartedSend.parse((await live.as(guest.token, 'POST', `/api/threads/${thread.id}/messages`, { text, sessionChoice: { kind: 'auto' } })).body);
    await live.chat.events.finished(generationId);
  };

  await live.chat.send(shared.thread, ECHO_CALL('owner'));
  const owner = await lastReply(live, shared.thread);
  await memberSend(shared.thread, ECHO_CALL('member'));
  const member = await lastReply(live, shared.thread);
  await live.chat.send(plain.thread, ECHO_CALL('unshared'));
  const unshared = await lastReply(live, plain.thread);

  expect({ owner, member, unshared }).toMatchInlineSnapshot(`
    {
      "member": "assistant(completed): notes__echo: error This agent is shared, so connectors are given only to turns the owner starts.",
      "owner": "assistant(completed): notes__echo: work ran echo with {"text":"owner"}",
      "unshared": "assistant(completed): notes__echo: work ran echo with {"text":"unshared"}",
    }
  `);
});

it('a member’s queued message steered into the owner’s running turn takes the connectors away from that turn', async () => {
  kit = await startMemberKit();
  const live = kit;
  const shared = await live.named('Shared');
  await live.chat.host.call('POST', '/api/connectors', { label: 'Notes', setup: stdioSetup('work', path.join(live.chat.dataDir, 'log')), scope: { mode: 'all', agentIds: [] } });
  const guest = await live.join('Guest', { kind: 'scoped', agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });

  const { generationId } = StartedSend.parse((await live.chat.host.call('POST', `/api/threads/${shared.thread.id}/messages`, { text: 'steerable' })).body);
  await live.chat.events.until((event) => event.kind === 'generation.delta' && event.generationId === generationId);
  const { queued } = QueuedSend.parse((await live.as(guest.token, 'POST', `/api/threads/${shared.thread.id}/messages`, { text: ECHO_CALL('steered'), sessionChoice: { kind: 'auto' } })).body);
  const steer = await live.as(guest.token, 'POST', `/api/threads/${shared.thread.id}/queue/${queued.id}/steer`);
  await live.chat.events.finished(generationId);

  expect({ steer: steer.status, reply: await lastReply(live, shared.thread) }).toMatchInlineSnapshot(`
    {
      "reply": "assistant(completed):  heard: [The user typed this message in the chat while you were working. It is from the user, not from a tool. Reply to it visibly in your next message, and answer it if it is a question; then carry on with your task with it taken into account.]

    host-tool notes__echo {"text":"steered"}
    notes__echo: error This agent is shared, so connectors are given only to turns the owner starts.",
      "steer": 204,
    }
  `);
});
