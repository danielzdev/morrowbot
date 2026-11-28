import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ContinueResponse, MessageList, QueuedSend, StartedSend, type ChatEvent, type Thread } from '@morrowbot/contracts';
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

/** An owner's agent shared with a member, a `Notes` connector given to every agent, and the member's token. */
async function sharedSetup(live: MemberKit): Promise<{ readonly thread: Thread; readonly token: string }> {
  const shared = await live.named('Shared');
  await live.chat.host.call('POST', '/api/connectors', { label: 'Notes', setup: stdioSetup('work', path.join(live.chat.dataDir, 'log')), scope: { mode: 'all', agentIds: [] } });
  const guest = await live.join('Guest', { kind: 'scoped', agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] }] });
  return { thread: shared.thread, token: guest.token };
}

const echoDir = (live: MemberKit): string => path.join(live.chat.dataDir, 'plugin-data', 'echo');

async function latestId(live: MemberKit, thread: Thread): Promise<string> {
  return MessageList.parse((await live.chat.host.call('GET', `/api/threads/${thread.id}/messages`)).body).messages.at(-1)?.id ?? '';
}

async function continued(live: MemberKit, thread: Thread): Promise<string | undefined> {
  const failedMessageId = await latestId(live, thread);
  const { generationId } = ContinueResponse.parse((await live.chat.host.call('POST', `/api/threads/${thread.id}/continue`, { failedMessageId, sessionChoice: { kind: 'auto' } })).body);
  await live.chat.events.finished(generationId);
  return lastReply(live, thread);
}

it('Continue answers the failed turn’s own input: a member’s stays without connectors after a quiet owner reaction, the owner’s own keeps them', async () => {
  kit = await startMemberKit();
  const live = kit;
  const { thread, token } = await sharedSetup(live);
  await live.chat.send(thread, 'Deployed. on-reaction stay_quiet {}');
  const reacted = await latestId(live, thread);
  const failed = StartedSend.parse((await live.as(token, 'POST', `/api/threads/${thread.id}/messages`, { text: `once-fail\n${ECHO_CALL('member retry')}`, sessionChoice: { kind: 'auto' } })).body);
  await live.chat.events.finished(failed.generationId);
  const quiet = (event: ChatEvent): boolean => event.kind === 'generation.background-finished' && event.threadId === thread.id;
  await live.chat.host.call('PUT', `/api/threads/${thread.id}/reactions`, { messageId: reacted, emoji: '👍', reacted: true });
  await live.chat.events.until(quiet);
  const memberRetry = await continued(live, thread);

  await rm(path.join(echoDir(live), 'failed-once'));
  await live.chat.send(thread, `once-fail\n${ECHO_CALL('owner retry')}`);
  const ownerRetry = await continued(live, thread);

  expect({ memberRetry, ownerRetry }).toMatchInlineSnapshot(`
    {
      "memberRetry": "assistant(completed): notes__echo: error This agent is shared, so connectors are given only to turns the owner starts.",
      "ownerRetry": "assistant(completed): notes__echo: work ran echo with {"text":"owner retry"}",
    }
  `);
});

it('a member’s message queued behind the owner’s reply runs next without connectors', async () => {
  kit = await startMemberKit();
  const live = kit;
  const { thread, token } = await sharedSetup(live);
  const owner = StartedSend.parse((await live.chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'gate' })).body);
  const { queued } = QueuedSend.parse((await live.as(token, 'POST', `/api/threads/${thread.id}/messages`, { text: ECHO_CALL('queued'), sessionChoice: { kind: 'auto' } })).body);
  await mkdir(echoDir(live), { recursive: true });
  await writeFile(path.join(echoDir(live), 'gate'), '');
  await live.chat.events.finished(owner.generationId);
  const next = (event: ChatEvent): boolean => event.kind === 'generation.started' && event.userMessage?.id === queued.id;
  await live.chat.events.until(next);
  const started = live.chat.events.received.find(next);
  if (started?.kind === 'generation.started') await live.chat.events.finished(started.generationId);

  expect(await lastReply(live, thread)).toMatchInlineSnapshot(`"assistant(completed): notes__echo: error This agent is shared, so connectors are given only to turns the owner starts."`);
});
