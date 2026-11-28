import { CreateVaultItemRequest, type CreateConnectorRequest } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { startConnectorKit, STDIO_SERVER, type ConnectorKit } from './testing/connector-kit.ts';
import { startHttpFixture, type HttpFixture } from './testing/mcp-http-server.ts';

let kit: ConnectorKit | undefined;
const servers: HttpFixture[] = [];
afterEach(async () => {
  expect(kit?.errors).toEqual([]);
  await kit?.close();
  for (const server of servers.splice(0)) await server.close();
  kit = undefined;
});

const ALL: CreateConnectorRequest['scope'] = { mode: 'all', agentIds: [] };
const HEADER_VALUE = 'Bearer vault-token-9a8b7c';
const COMPOSIO_KEY = 'composio-vault-key-1d2e';
const STDIO_TOKEN = 'stdio-vault-token-3f4a';

function said(answer: unknown): string {
  const text = JSON.stringify(answer);
  return /"text":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? text;
}

async function saved(target: ConnectorKit, request: object): Promise<string> {
  const result = await target.vault.create(CreateVaultItemRequest.parse(request));
  if (result.kind !== 'saved') throw new Error(result.kind);
  return result.item.id;
}

it('connects with header and key values read from the Vault, reports a deleted item without its value, and hides echoed values', async () => {
  const remote = await startHttpFixture({ tools: 'plain', header: 'authorization', value: HEADER_VALUE, account: 'remote' });
  const composio = await startHttpFixture({ tools: 'composio', header: 'x-api-key', value: COMPOSIO_KEY });
  servers.push(remote, composio);
  const started = await startConnectorKit({ agentIds: ['agent-a'] });
  kit = started;
  const header = await saved(started, { kind: 'header_secret', label: 'Remote token', headerName: 'Authorization', value: HEADER_VALUE });
  const key = await saved(started, { kind: 'api_key', label: 'Composio', key: COMPOSIO_KEY });
  const token = await saved(started, { kind: 'api_key', label: 'Notes token', key: STDIO_TOKEN });
  const login = await saved(started, { kind: 'login', label: 'Forge', site: 'git.example', username: 'robot', password: 'pw-forge-5b6c' });

  const http = await started.add({ label: 'Remote', setup: { kind: 'http', url: remote.url, headers: [{ kind: 'vault', name: 'Authorization', vaultId: header }] }, scope: ALL });
  const gmail = await started.add({
    label: 'Gmail',
    setup: { kind: 'composio', toolkit: 'gmail', serverUrl: composio.url, apiKey: { kind: 'vault', vaultId: key }, account: { kind: 'user', userId: 'work-user' } },
    scope: ALL,
  });
  const notes = await started.add({ label: 'Notes', setup: { kind: 'stdio', command: process.execPath, args: [STDIO_SERVER], env: [{ kind: 'vault', name: 'FIXTURE_TOKEN', vaultId: token }] }, scope: ALL });
  const wrongKind = await started.add({ label: 'Wrong kind', setup: { kind: 'http', url: remote.url, headers: [{ kind: 'vault', name: 'Authorization', vaultId: login }] }, scope: ALL });
  const turn = started.turn('agent-a');
  const working = {
    remote: said(await turn.call('remote__echo', { text: 'hi' })),
    gmail: said(await turn.call('gmail__GMAIL_SEND_EMAIL', {})),
    echoedToken: said(await turn.call('notes__echo', { text: 'leak' })),
    httpView: started.view(http).setup,
    gmailView: started.view(gmail).setup,
    wrongKind: started.view(wrongKind).status,
  };

  await started.vault.delete(header);
  started.connectors.connect(http);
  await started.connectors.settled(http);
  const afterDelete = { status: started.view(http).status, call: said(await turn.call('remote__echo', { text: 'hi' })) };

  const everything = JSON.stringify({ working, afterDelete, views: started.connectors.list(), errors: started.errors, notes: started.view(notes) });
  const masked: unknown = JSON.parse(JSON.stringify(working).replaceAll(header, '<header>').replaceAll(key, '<key>').replaceAll(new URL(remote.url).port, '<port>').replaceAll(new URL(composio.url).port, '<port>'));
  expect({
    working: masked,
    afterDelete,
    leaked: [HEADER_VALUE, 'vault-token-9a8b7c', COMPOSIO_KEY, STDIO_TOKEN, 'pw-forge-5b6c'].filter((secret) => everything.includes(secret)),
    seenByRemote: remote.log.requests.map((line) => line.replace(/ session=.*/, '')),
  }).toMatchInlineSnapshot(`
    {
      "afterDelete": {
        "call": "Remote isn't connected right now.",
        "status": {
          "kind": "reconnect_needed",
          "message": "Header Authorization: its Vault item was deleted. Edit the connector and pick another.",
        },
      },
      "leaked": [],
      "seenByRemote": [
        "POST initialize account=remote auth=true",
        "POST notifications/initialized account=remote auth=true",
        "POST tools/list account=remote auth=true",
        "POST tools/call account=remote auth=true",
        "POST answer account=remote auth=true",
        "DELETE answer account=remote auth=true",
      ],
      "working": {
        "echoedToken": "Notes: The server answered with error -32000: Rejected token [hidden]",
        "gmail": "work-user ran GMAIL_SEND_EMAIL with {}",
        "gmailView": {
          "account": {
            "kind": "user",
            "userId": "work-user",
          },
          "apiKey": {
            "kind": "vault",
            "vaultId": "<key>",
          },
          "kind": "composio",
          "serverUrl": "http://127.0.0.1:<port>/mcp/server-1",
          "toolkit": "gmail",
        },
        "httpView": {
          "headers": [
            {
              "kind": "vault",
              "name": "Authorization",
              "vaultId": "<header>",
            },
          ],
          "kind": "http",
          "url": "http://127.0.0.1:<port>/mcp/server-1",
        },
        "remote": "remote ran echo with {\\"text\\":\\"hi\\"}",
        "wrongKind": {
          "kind": "reconnect_needed",
          "message": "Header Authorization: its Vault item is a login. Pick an API key or header secret.",
        },
      },
    }
  `);
});
