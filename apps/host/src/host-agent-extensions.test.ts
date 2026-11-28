import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, ApiError, ClaimInviteResponse, Folder, InviteResponse, StartedSend, type HostTools, type Thread } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ECHO, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { postMcp, savedTools } from './testing/host-tools-client.ts';
import { URL_FOR_MEMBERS } from './testing/member-kit.ts';
import { DEFAULT_PLUGIN_TIMEOUTS, PLUGIN_FIXTURES, sequence } from './testing/test-host.ts';
import { PLUGIN_SDK_URL, writeToolPlugin } from './testing/tool-plugin-fixture.ts';

const ListBody = z.looseObject({
  result: z.looseObject({ tools: z.array(z.looseObject({ name: z.string() })) }),
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

async function openTurn(
  chat: ChatFixture,
  dataDir: string,
  thread: Thread,
  previousToken?: string,
): Promise<{ readonly generationId: string; readonly tools: Extract<HostTools, { kind: 'mcp' }> }> {
  const sent = StartedSend.parse((await chat.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } })).body);
  const tools = await vi.waitFor(async () => {
    const saved = await savedTools(dataDir);
    if (saved.kind !== 'mcp' || saved.token === previousToken) throw new Error('waiting for mcp host tools');
    return saved;
  });
  return { generationId: sent.generationId, tools };
}

async function listedNames(tools: Extract<HostTools, { kind: 'mcp' }>): Promise<string[]> {
  const response = await postMcp(tools.url, tools.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect(response.status).toBe(200);
  return ListBody.parse(response.body).result.tools.map((t) => t.name);
}

it('enforces per-agent disabledExtensions, preserves opt-outs across app-wide toggles, bumps revision on folder delete, and blocks scoped members', async () => {
  const dataDir = await makeTempDir('morrowbot-agent-ext-data-');
  const pluginsDir = await makeTempDir('morrowbot-agent-ext-plugins-');
  await writeToolPlugin(
    pluginsDir,
    'gadget',
    `import { defineToolPlugin, runPlugin } from ${JSON.stringify(PLUGIN_SDK_URL)};
runPlugin(() => defineToolPlugin({
  listTools: () => [{ name: 'ping', description: 'Ping gadget', inputSchema: { type: 'object' } }],
  callTool: () => ({ kind: 'ok', content: [{ kind: 'text', text: 'pong-gadget' }] }),
}));`,
  );
  await writeToolPlugin(
    pluginsDir,
    'notes',
    `import { defineToolPlugin, runPlugin } from ${JSON.stringify(PLUGIN_SDK_URL)};
runPlugin(() => defineToolPlugin({
  listTools: () => [{ name: 'read', description: 'Read notes', inputSchema: { type: 'object' } }],
  callTool: () => ({ kind: 'ok', content: [{ kind: 'text', text: 'pong-notes' }] }),
}));`,
  );

  const chat = await startChatFixture({
    dataDir,
    builtinPluginsDir: PLUGIN_FIXTURES,
    pluginsDir,
    sequence: sequence(),
    timeouts: { ...DEFAULT_PLUGIN_TIMEOUTS, toolCallMs: 500 },
  });
  cleanups.push(async () => {
    await chat.close();
    expect(chat.host.errors).toEqual([]);
  });

  const folder = Folder.parse((await chat.host.call('POST', '/api/folders', { name: 'Team' })).body);
  const agentA = Agent.parse((await chat.host.call('POST', '/api/agents', { name: 'Agent A', provider: ECHO, folderId: folder.id })).body);
  const agentB = Agent.parse((await chat.host.call('POST', '/api/agents', { name: 'Agent B', provider: ECHO })).body);

  // Scoped member with edit permission cannot modify disabledExtensions
  const invite = InviteResponse.parse(
    (
      await chat.host.call('POST', '/api/members/invites', {
        name: 'Guest',
        access: { kind: 'scoped', agents: [{ agentId: agentB.id, workspace: 'read-only', canEdit: true }] },
        url: URL_FOR_MEMBERS,
      })
    ).body,
  );
  const claimResponse = await fetch(`${chat.host.url}/api/members/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: invite.code, deviceName: 'Guest laptop', platform: 'macos' }),
  });
  const claimed = ClaimInviteResponse.parse(await claimResponse.json());
  const scopedForbidden = await fetch(`${chat.host.url}/api/agents/${agentB.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${claimed.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ disabledExtensions: ['gadget'], revision: agentB.revision }),
  });

  // Deleting a folder bumps affected agent's revision so stale pre-delete PATCH returns 409
  const delFolder = await chat.host.call('DELETE', `/api/folders/${folder.id}`);
  expect(delFolder.status).toBe(204);
  const staleAfterFolderDelete = await chat.host.call('PATCH', `/api/agents/${agentA.id}`, {
    disabledExtensions: ['notes'],
    revision: agentA.revision,
  });

  // Disable `gadget` for Agent B only, using revision 0
  const disableReply = await chat.host.call('PATCH', `/api/agents/${agentB.id}`, {
    disabledExtensions: ['gadget'],
    revision: agentB.revision,
  });
  expect(disableReply.status).toBe(200);
  const updatedB = Agent.parse(disableReply.body);

  // Stale revision 0 must fail with 409 agent-conflict carrying current revision 1
  const conflictReply = await chat.host.call('PATCH', `/api/agents/${agentB.id}`, {
    disabledExtensions: ['notes'],
    revision: 0,
  });
  const conflictError = ApiError.parse(conflictReply.body).error;

  // Agent B's turn: gadget_ping is hidden and refused, while notes_read works
  const threadB = await chat.thread(updatedB);
  const turnB = await openTurn(chat, dataDir, threadB);
  const namesB = await listedNames(turnB.tools);
  const callGadgetB = await postMcp(turnB.tools.url, turnB.tools.token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'gadget_ping', arguments: {} },
  });
  const callNotesB = await postMcp(turnB.tools.url, turnB.tools.token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'notes_read', arguments: {} },
  });

  // App-wide disable -> re-enable preserves Agent B's per-agent opt-out
  await chat.host.call('PUT', '/api/plugins/gadget/enabled', { enabled: false });
  await chat.host.call('PUT', '/api/plugins/gadget/enabled', { enabled: true });
  const namesBAfterAppToggle = await listedNames(turnB.tools);

  // Re-enable `gadget` for Agent B mid-turn at revision 1 -> immediately visible
  const reenableReply = await chat.host.call('PATCH', `/api/agents/${agentB.id}`, {
    disabledExtensions: [],
    revision: updatedB.revision,
  });
  expect(reenableReply.status).toBe(200);
  const namesBAfterReenable = await listedNames(turnB.tools);
  await chat.host.call('POST', `/api/threads/${threadB.id}/stop`);
  await chat.events.finished(turnB.generationId);

  // Agent A was never disabled and always sees gadget_ping
  const threadA = await chat.thread(agentA);
  const turnA = await openTurn(chat, dataDir, threadA, turnB.tools.token);
  const namesA = await listedNames(turnA.tools);
  await chat.host.call('POST', `/api/threads/${threadA.id}/stop`);
  await chat.events.finished(turnA.generationId);

  expect({
    scopedForbiddenStatus: scopedForbidden.status,
    staleAfterFolderDeleteStatus: staleAfterFolderDelete.status,
    staleAfterFolderDeleteKind: ApiError.parse(staleAfterFolderDelete.body).error.kind,
    updatedBRevision: updatedB.revision,
    updatedBDisabled: updatedB.disabledExtensions,
    conflictStatus: conflictReply.status,
    conflictKind: conflictError.kind,
    conflictMessage: conflictError.message,
    conflictCurrentRevision: conflictError.kind === 'agent-conflict' ? conflictError.current.revision : null,
    bSeesGadgetWhileDisabled: namesB.includes('gadget_ping'),
    bSeesNotesWhileDisabled: namesB.includes('notes_read'),
    bSeesGadgetAfterAppToggle: namesBAfterAppToggle.includes('gadget_ping'),
    bCallGadgetWhileDisabled: callGadgetB.body,
    bCallNotesWhileDisabled: callNotesB.body,
    bSeesGadgetAfterReenable: namesBAfterReenable.includes('gadget_ping'),
    aSeesGadget: namesA.includes('gadget_ping'),
  }).toMatchInlineSnapshot(`
    {
      "aSeesGadget": true,
      "bCallGadgetWhileDisabled": {
        "error": {
          "code": -32602,
          "message": "Unknown tool: gadget_ping",
        },
        "id": 2,
        "jsonrpc": "2.0",
      },
      "bCallNotesWhileDisabled": {
        "id": 3,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "pong-notes",
              "type": "text",
            },
          ],
          "isError": false,
        },
      },
      "bSeesGadgetAfterAppToggle": false,
      "bSeesGadgetAfterReenable": true,
      "bSeesGadgetWhileDisabled": false,
      "bSeesNotesWhileDisabled": true,
      "conflictCurrentRevision": 1,
      "conflictKind": "agent-conflict",
      "conflictMessage": "Changed elsewhere.",
      "conflictStatus": 409,
      "scopedForbiddenStatus": 403,
      "staleAfterFolderDeleteKind": "agent-conflict",
      "staleAfterFolderDeleteStatus": 409,
      "updatedBDisabled": [
        "gadget",
      ],
      "updatedBRevision": 1,
    }
  `);
});
