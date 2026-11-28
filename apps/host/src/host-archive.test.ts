import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentList, AgentMessage, QueuedSend, Thread, ThreadList, ThreadState, ThreadSummaryList } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { startMemberKit } from './testing/member-kit.ts';

let dataDir: string;
let chat: ChatFixture | undefined;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-archive-')));
});
afterEach(async () => {
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  chat = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

it('archives chats out of default lists without deleting them, rejects sends while archived, and restores them cleanly', async () => {
  chat = await startChatFixture({ dataDir });
  const agent = await chat.agent();
  const main = await chat.thread(agent, 'Main');
  const side = await chat.thread(agent, 'Side topic');
  await chat.send(side, 'remember this');

  const archivedReply = await chat.host.call('POST', `/api/threads/${side.id}/archive`);
  const archived = Thread.parse(archivedReply.body);
  const activeList = ThreadList.parse((await chat.host.call('GET', `/api/agents/${agent.id}/threads`)).body).threads;
  const archivedList = ThreadList.parse((await chat.host.call('GET', `/api/agents/${agent.id}/threads?archived=only`)).body).threads;
  const summaries = ThreadSummaryList.parse((await chat.host.call('GET', '/api/threads')).body).threads;
  const agents = AgentList.parse((await chat.host.call('GET', '/api/agents')).body);
  const stateWhileArchived = ThreadState.parse((await chat.host.call('GET', `/api/threads/${side.id}/state`)).body);
  const sendWhileArchived = await chat.host.call('POST', `/api/threads/${side.id}/messages`, { text: 'should refuse' });
  const badQuery = await chat.host.call('GET', `/api/agents/${agent.id}/threads?archived=bogus`);

  const restoredReply = await chat.host.call('POST', `/api/threads/${side.id}/restore`);
  const restored = Thread.parse(restoredReply.body);
  const activeAfterRestore = ThreadList.parse((await chat.host.call('GET', `/api/agents/${agent.id}/threads`)).body).threads;
  const archivedAfterRestore = ThreadList.parse((await chat.host.call('GET', `/api/agents/${agent.id}/threads?archived=only`)).body).threads;

  expect({
    archiveStatus: archivedReply.status,
    archivedHasTimestamp: archived.archivedAt !== null,
    activeIds: activeList.map(({ id }) => id),
    archivedIds: archivedList.map(({ id }) => id),
    summaryIds: summaries.map(({ thread }) => thread.id),
    lastMessagesCount: agents.lastMessages.length,
    preservedMessages: stateWhileArchived.messages.length,
    sendWhileArchived: { status: sendWhileArchived.status, body: sendWhileArchived.body },
    badQueryStatus: badQuery.status,
    restoreStatus: restoredReply.status,
    restoredArchivedAt: restored.archivedAt,
    activeAfterRestore: activeAfterRestore.map(({ id }) => id),
    archivedAfterRestore: archivedAfterRestore.map(({ id }) => id),
    mainId: main.id,
  }).toMatchInlineSnapshot(`
    {
      "activeAfterRestore": [
        "id-2",
        "id-3",
      ],
      "activeIds": [
        "id-2",
      ],
      "archiveStatus": 200,
      "archivedAfterRestore": [],
      "archivedHasTimestamp": true,
      "archivedIds": [
        "id-3",
      ],
      "badQueryStatus": 400,
      "lastMessagesCount": 0,
      "mainId": "id-2",
      "preservedMessages": 2,
      "restoreStatus": 200,
      "restoredArchivedAt": null,
      "sendWhileArchived": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Restore this chat before sending a message.",
          },
        },
        "status": 409,
      },
      "summaryIds": [
        "id-2",
      ],
    }
  `);
});

it('refuses to archive a thread while a reply is running', async () => {
  chat = await startChatFixture({ dataDir });
  const thread = await chat.thread(await chat.agent(), 'Busy');
  await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'stall-polite' });
  await chat.events.until((event) => event.kind === 'generation.delta');
  const refused = await chat.host.call('POST', `/api/threads/${thread.id}/archive`);
  await chat.host.call('POST', `/api/threads/${thread.id}/stop`);
  const afterStop = await chat.host.call('POST', `/api/threads/${thread.id}/archive`);
  expect({ refused: { status: refused.status, body: refused.body }, afterStop: afterStop.status }).toMatchInlineSnapshot(`
    {
      "afterStop": 200,
      "refused": {
        "body": {
          "error": {
            "kind": "conflict",
            "message": "Stop the reply before archiving this chat.",
          },
        },
        "status": 409,
      },
    }
  `);
});

it('rejects steer on an archived thread with 409 and resumes unread agent messages on restore', async () => {
  chat = await startChatFixture({ dataDir });
  const lead = await chat.agent();
  const peer = await chat.agent();
  const leadMain = await chat.thread(lead, 'Lead main');
  const peerMain = await chat.thread(peer, 'Peer main');

  // Create a held queued message, archive the thread, and confirm steer returns 409
  await chat.host.call('POST', `/api/threads/${leadMain.id}/messages`, { text: 'stall-polite' });
  await chat.events.until((event) => event.kind === 'generation.delta');
  const queued = QueuedSend.parse((await chat.host.call('POST', `/api/threads/${leadMain.id}/messages`, { text: 'held note' })).body).queued;
  await chat.host.call('POST', `/api/threads/${leadMain.id}/stop`);
  await chat.host.call('POST', `/api/threads/${leadMain.id}/archive`);
  const steerArchived = await chat.host.call('POST', `/api/threads/${leadMain.id}/queue/${queued.id}/steer`);

  // Restore Lead's main chat and post an agent message from Lead -> Peer, then archive Peer's chat before a reply arrives
  await chat.host.call('POST', `/api/threads/${leadMain.id}/restore`);
  const ask = AgentMessage.parse(
    (
      await chat.host.call('POST', `/api/agents/${peer.id}/messages`, {
        kind: 'new',
        toAgentId: lead.id,
        fromThreadId: peerMain.id,
        text: 'Quick question',
        expectsReply: true,
      })
    ).body,
  );
  await chat.events.until((event) => event.kind === 'generation.background-finished' && event.threadId === leadMain.id);

  // Archive peerMain, then have Lead reply to peerMain while it is archived; restoring peerMain triggers the background read
  await chat.host.call('POST', `/api/threads/${peerMain.id}/archive`);
  await chat.host.call('POST', `/api/agents/${lead.id}/messages`, {
    kind: 'reply',
    replyToMessageId: ask.id,
    text: 'Here is the answer',
    expectsReply: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const readWhileArchived = chat.events.received.some(
    (event) => event.kind === 'generation.background-started' && event.threadId === peerMain.id,
  );
  await chat.host.call('POST', `/api/threads/${peerMain.id}/restore`);
  await chat.events.until((event) => event.kind === 'generation.background-finished' && event.threadId === peerMain.id);
  const readAfterRestore = chat.events.received.some(
    (event) => event.kind === 'generation.background-finished' && event.threadId === peerMain.id,
  );

  expect({
    steerArchivedStatus: steerArchived.status,
    readWhileArchived,
    readAfterRestore,
  }).toMatchInlineSnapshot(`
    {
      "readAfterRestore": true,
      "readWhileArchived": false,
      "steerArchivedStatus": 409,
    }
  `);
});

it('requires edit permission on archive and restore routes for scoped members', async () => {
  const kit = await startMemberKit();
  try {
    const viewOnly = await kit.named('ViewOnly');
    const editable = await kit.named('Editable');
    const guest = await kit.join('Guest', {
      kind: 'scoped',
      agents: [
        { agentId: viewOnly.agent.id, canEdit: false, workspace: 'read-only', interAgentAllowlist: [] },
        { agentId: editable.agent.id, canEdit: true, workspace: 'read-only', interAgentAllowlist: [] },
      ],
    });
    const viewArchive = (await kit.as(guest.token, 'POST', `/api/threads/${viewOnly.thread.id}/archive`)).status;
    await kit.chat.host.call('POST', `/api/threads/${viewOnly.thread.id}/archive`);
    const viewRestore = (await kit.as(guest.token, 'POST', `/api/threads/${viewOnly.thread.id}/restore`)).status;
    const editArchive = (await kit.as(guest.token, 'POST', `/api/threads/${editable.thread.id}/archive`)).status;
    const editRestore = (await kit.as(guest.token, 'POST', `/api/threads/${editable.thread.id}/restore`)).status;
    expect({ viewArchive, viewRestore, editArchive, editRestore }).toMatchInlineSnapshot(`
      {
        "editArchive": 200,
        "editRestore": 200,
        "viewArchive": 403,
        "viewRestore": 403,
      }
    `);
  } finally {
    await kit.close();
  }
});
