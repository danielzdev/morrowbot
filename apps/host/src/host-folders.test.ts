import { AgentList, Folder } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { hidePid, startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';

let chat: ChatFixture | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

function sidebar(body: unknown): unknown {
  const list = AgentList.parse(body);
  return {
    agents: list.agents.map(({ id, name, folderId }) => ({ id, name, folderId })),
    folders: list.folders,
    lastMessages: list.lastMessages.map((last) => ({ ...last, preview: hidePid(last.preview) })),
  };
}

it('files agents into folders, previews their last message, and unfiles them when the folder is deleted', async () => {
  chat = await startChatFixture();
  const { host } = chat;
  const gardener = await chat.agent();
  await host.call('POST', '/api/agents', { name: 'Quiet Owl' });
  const created = await host.call('POST', '/api/folders', { name: '  Hobbies ' });
  const folder = Folder.parse(created.body);
  const steps = {
    created,
    moved: (await host.call('PATCH', `/api/agents/${gardener.id}`, { folderId: folder.id })).status,
    moveToUnknown: await host.call('PATCH', `/api/agents/${gardener.id}`, { folderId: 'no-such-folder' }),
    createInUnknown: await host.call('POST', '/api/agents', { name: 'Lost Fox', folderId: 'no-such-folder' }),
    renamed: await host.call('PATCH', `/api/folders/${folder.id}`, { name: 'Garden' }),
    renameUnknown: (await host.call('PATCH', '/api/folders/no-such-folder', { name: 'Garden' })).status,
  };
  await chat.send(await chat.thread(gardener), '  water\n\n  the   ferns\t');
  const filed = sidebar((await host.call('GET', '/api/agents')).body);
  const deleted = (await host.call('DELETE', `/api/folders/${folder.id}`)).status;
  const deleteAgain = (await host.call('DELETE', `/api/folders/${folder.id}`)).status;
  const unfiled = sidebar((await host.call('GET', '/api/agents')).body);

  expect({ ...steps, filed, deleted, deleteAgain, unfiled }).toMatchInlineSnapshot(`
    {
      "createInUnknown": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "folderId: No such folder",
          },
        },
        "status": 400,
      },
      "created": {
        "body": {
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-3",
          "name": "Hobbies",
        },
        "status": 201,
      },
      "deleteAgain": 404,
      "deleted": 204,
      "filed": {
        "agents": [
          {
            "folderId": "id-3",
            "id": "id-1",
            "name": "Helper",
          },
          {
            "folderId": null,
            "id": "id-2",
            "name": "Quiet Owl",
          },
        ],
        "folders": [
          {
            "createdAt": "2026-01-01T00:00:02.000Z",
            "id": "id-3",
            "name": "Garden",
          },
        ],
        "lastMessages": [
          {
            "agentId": "id-1",
            "at": "2026-01-01T00:00:07.000Z",
            "kind": "assistant",
            "preview": "hello from pid <pid>:   water

      the   ferns",
            "threadId": "id-4",
          },
        ],
      },
      "moveToUnknown": {
        "body": {
          "error": {
            "kind": "invalid_request",
            "message": "folderId: No such folder",
          },
        },
        "status": 400,
      },
      "moved": 200,
      "renameUnknown": 404,
      "renamed": {
        "body": {
          "createdAt": "2026-01-01T00:00:02.000Z",
          "id": "id-3",
          "name": "Garden",
        },
        "status": 200,
      },
      "unfiled": {
        "agents": [
          {
            "folderId": null,
            "id": "id-1",
            "name": "Helper",
          },
          {
            "folderId": null,
            "id": "id-2",
            "name": "Quiet Owl",
          },
        ],
        "folders": [],
        "lastMessages": [
          {
            "agentId": "id-1",
            "at": "2026-01-01T00:00:07.000Z",
            "kind": "assistant",
            "preview": "hello from pid <pid>:   water

      the   ferns",
            "threadId": "id-4",
          },
        ],
      },
    }
  `);
});
