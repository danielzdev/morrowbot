import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultItem, VaultItemList } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { startMemberKit } from './testing/member-kit.ts';
import { sequence } from './testing/test-host.ts';

let dataDir: string;
let chat: ChatFixture;
beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-vault-host-')));
  chat = await startChatFixture({ dataDir, sequence: sequence() });
});
afterEach(async () => {
  await chat.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** Every secret value sent to the host. None may come back out anywhere. */
const SECRETS = ['pw-first-0a1b', 'pw-second-2c3d', 'JBSWY3DPEHPK3PXP', 'jbsw y3dp ehpk 3pxp', 'key-value-4e5f', 'header-value-6a7b', 'bad-key-8c9d', 'leaked-extra-0e1f'];

const leaks = (text: string): string[] => SECRETS.filter((secret) => text.includes(secret));

it('manages vault items over HTTP and lists them to agents, without a secret in any reply, error, event, log or database', async () => {
  const replies: unknown[] = [];
  const call = async (method: string, route: string, body?: unknown) => {
    const reply = await chat.host.call(method, route, body);
    replies.push(reply);
    return reply;
  };
  const created = async (body: object) => VaultItem.parse((await call('POST', '/api/vault', body)).body);
  const login = await created({ kind: 'login', label: 'Git forge', site: 'git.example', username: 'robot', password: 'pw-first-0a1b', twoStepKey: 'jbsw y3dp ehpk 3pxp' });
  await created({ kind: 'api_key', label: 'Weather API', key: 'key-value-4e5f' });
  const header = await created({ kind: 'header_secret', label: 'Search', headerName: 'X-Api-Key', value: 'header-value-6a7b' });
  const refusals = {
    badTwoStepKey: await call('PATCH', `/api/vault/${login.id}`, { kind: 'login', twoStepKey: 'bad-key-8c9d' }),
    secretInUnknownField: await call('POST', '/api/vault', { kind: 'api_key', label: 'X', key: 'key-value-4e5f', password: 'leaked-extra-0e1f' }),
    otherKind: await call('PATCH', `/api/vault/${header.id}`, { kind: 'api_key', key: 'leaked-extra-0e1f' }),
    tooLong: await call('POST', '/api/vault', { kind: 'api_key', label: 'X', key: `leaked-extra-0e1f${'x'.repeat(16_384)}` }),
  };
  await call('PATCH', `/api/vault/${login.id}`, { kind: 'login', password: 'pw-second-2c3d' });
  expect((await call('DELETE', `/api/vault/${header.id}`)).status).toBe(204);
  const listed = await call('GET', '/api/vault');

  const agent = await chat.agent();
  const thread = await chat.thread(agent);
  await chat.send(thread, 'host-tool list_vault_items {}');
  const toolReply = (await chat.history(thread)).at(-1) ?? '';

  const files = await readdir(dataDir, { recursive: true });
  const onDisk = await Promise.all(
    files.filter((file) => !file.endsWith('vault-secrets.json') && !file.endsWith('vault.key')).map(async (file) => readFile(path.join(dataDir, file), 'latin1').catch(() => '')),
  );
  expect(onDisk.join('\n')).toContain('Git forge');
  expect({
    leakedInReplies: leaks(JSON.stringify(replies)),
    leakedToAgent: leaks(toolReply),
    leakedInEvents: leaks(JSON.stringify(chat.events.received)),
    leakedInErrors: leaks(chat.host.errors.map(String).join('\n')),
    leakedOnDisk: leaks(onDisk.join('\n')),
  }).toEqual({ leakedInReplies: [], leakedToAgent: [], leakedInEvents: [], leakedInErrors: [], leakedOnDisk: [] });
  expect(chat.host.errors).toEqual([]);

  expect({ refusals, listed, toolReply }).toMatchInlineSnapshot(`
    {
      "listed": {
        "body": {
          "items": [
            {
              "createdAt": "2026-01-01T00:00:00.000Z",
              "hasTotp": true,
              "id": "id-1",
              "kind": "login",
              "label": "Git forge",
              "site": "git.example",
              "updatedAt": "2026-01-01T00:00:03.000Z",
              "username": "robot",
            },
            {
              "createdAt": "2026-01-01T00:00:01.000Z",
              "id": "id-2",
              "kind": "api_key",
              "label": "Weather API",
              "site": null,
              "updatedAt": "2026-01-01T00:00:01.000Z",
            },
          ],
        },
        "status": 200,
      },
      "refusals": {
        "badTwoStepKey": {
          "body": {
            "error": {
              "kind": "invalid_request",
              "message": "twoStepKey: Enter the setup key as 16 or more letters A–Z and digits 2–7",
            },
          },
          "status": 400,
        },
        "otherKind": {
          "body": {
            "error": {
              "kind": "invalid_request",
              "message": "This item is a header secret and stays one",
            },
          },
          "status": 400,
        },
        "secretInUnknownField": {
          "body": {
            "error": {
              "kind": "invalid_request",
              "message": "(body): Unrecognized key: "password"",
            },
          },
          "status": 400,
        },
        "tooLong": {
          "body": {
            "error": {
              "kind": "invalid_request",
              "message": "key: Keep the secret under 16384 characters",
            },
          },
          "status": 400,
        },
      },
      "toolReply": "assistant(completed): list_vault_items: {"items":[{"id":"id-1","kind":"login","label":"Git forge","site":"git.example","username":"robot","hasTotp":true},{"id":"id-2","kind":"api_key","label":"Weather API","site":null}]}",
    }
  `);
});

it('keeps the vault to the owner: a member who may use only chosen agents cannot list or change it', async () => {
  const kit = await startMemberKit();
  try {
    const { agent } = await kit.named('Shared');
    const member = await kit.join('Guest', { kind: 'scoped', agents: [{ agentId: agent.id, canEdit: true, workspace: 'read-only', interAgentAllowlist: [] }] });
    const create = { kind: 'api_key', label: 'Guest key', key: 'key-value-4e5f' };
    expect({
      list: (await kit.as(member.token, 'GET', '/api/vault')).status,
      create: (await kit.as(member.token, 'POST', '/api/vault', create)).status,
      ownerSees: VaultItemList.parse((await kit.chat.host.call('GET', '/api/vault')).body).items.length,
    }).toEqual({ list: 403, create: 403, ownerSees: 0 });
  } finally {
    await kit.close();
  }
});
