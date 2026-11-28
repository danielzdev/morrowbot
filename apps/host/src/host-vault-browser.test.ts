import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StartedSend, VaultItem, type BrowserCommand } from '@morrowbot/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { startChatFixture, type ChatFixture } from './testing/chat-fixture.ts';
import { postMcp, savedTools } from './testing/host-tools-client.ts';
import { PLUGIN_FIXTURES, sequence } from './testing/test-host.ts';
import { connectFakeBrowser, freePort, PLUGIN_SDK_URL, writeToolPlugin, type FakeBrowserExtension } from './testing/tool-plugin-fixture.ts';

const REPO_PLUGINS_DIR = fileURLToPath(new URL('../../../plugins', import.meta.url));
const PAIRING_TOKEN = 'p'.repeat(43);
const PASSWORD = 'pw-shop-7f3a9c';
const API_KEY = 'key-value-5d2e8b';

let chat: ChatFixture | undefined;
let extension: FakeBrowserExtension | undefined;
let dataDir = '';
afterEach(async () => {
  extension?.close();
  await chat?.close();
  expect(chat?.host.errors ?? []).toEqual([]);
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  chat = undefined;
  extension = undefined;
});

it('fills a vault login into its own site only, and never shows the agent a password or code', async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-browser-')));
  const host = await startChatFixture({ dataDir, builtinPluginsDir: REPO_PLUGINS_DIR, sequence: sequence() });
  chat = host;
  const port = await freePort();
  expect((await host.host.call('PUT', '/api/plugins/browser/config', { config: { pairingToken: PAIRING_TOKEN, port, uploadFolder: '' } })).status).toBe(200);
  const browser = await connectFakeBrowser(port, PAIRING_TOKEN, ['list-tabs', 'fill-secret']);
  extension = browser;

  const created = async (body: object): Promise<VaultItem> => VaultItem.parse((await host.host.call('POST', '/api/vault', body)).body);
  const login = await created({ kind: 'login', label: 'Shop', site: 'shop.example', username: 'shopper', password: PASSWORD, twoStepKey: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
  const key = await created({ kind: 'api_key', label: 'Weather', site: 'shop.example', key: API_KEY });

  let tabUrl = '';
  const filled: BrowserCommand[] = [];
  void (async () => {
    for (;;) {
      const { id, command } = await browser.nextCommand();
      if (command.kind === 'list-tabs') {
        browser.reply(id, { kind: 'ok', value: { kind: 'tabs', tabs: [{ tabId: 7, windowId: 1, url: tabUrl, title: 'Log in', active: true, status: 'complete' }] } });
      } else {
        filled.push(command);
        browser.reply(id, { kind: 'ok', value: { kind: 'done' } });
      }
    }
  })();

  const thread = await host.thread(await host.agent());
  StartedSend.parse((await host.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } })).body);
  const tools = await vi.waitFor(async () => {
    const saved = await savedTools(dataDir);
    if (saved.kind !== 'mcp') throw new Error('waiting for mcp host tools');
    return saved;
  });
  let calls = 0;
  const fill = async (url: string, vaultId: string, field: string): Promise<unknown> => {
    tabUrl = url;
    const answer = await postMcp(tools.url, tools.token, { jsonrpc: '2.0', id: ++calls, method: 'tools/call', params: { name: 'browser_fill_secret', arguments: { tabId: 7, ref: 'e4', secret: { vaultId, field } } } });
    return answer.body;
  };
  const answers = {
    password: await fill('https://shop.example/login', login.id, 'password'),
    codeOnSubdomain: await fill('https://accounts.shop.example/2fa', login.id, 'one-time-code'),
    username: await fill('https://shop.example/login', login.id, 'username'),
    lookalikeSite: await fill('https://shop.example.evil.test/login', login.id, 'password'),
    plainHttp: await fill('http://shop.example/login', login.id, 'password'),
    notALogin: await fill('https://shop.example/login', key.id, 'password'),
    unknownItem: await fill('https://shop.example/login', 'gone-item', 'password'),
  };

  const [password, code, username, ...rest] = filled;
  const valueOf = (command: BrowserCommand | undefined): string => (command?.kind === 'fill-secret' ? command.value : '');
  const toAgent = JSON.stringify(answers).replaceAll(login.id, '<login>').replaceAll(key.id, '<key>');
  const shown: unknown = JSON.parse(toAgent);
  expect({
    filled: filled.map((command) => (command.kind === 'fill-secret' ? `${command.field} on ${command.origin}` : command.kind)),
    values: { password: valueOf(password) === PASSWORD, username: valueOf(username), codeIsSixDigits: /^\d{6}$/.test(valueOf(code)), extra: rest.length },
    leaked: [PASSWORD, API_KEY, valueOf(code)].filter((secret) => toAgent.includes(secret)),
    toAgent: shown,
  }).toMatchInlineSnapshot(`
    {
      "filled": [
        "password on https://shop.example",
        "one-time-code on https://accounts.shop.example",
        "username on https://shop.example",
      ],
      "leaked": [],
      "toAgent": {
        "codeOnSubdomain": {
          "id": 2,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Filled the one-time-code of vault login <login> into e4.",
                "type": "text",
              },
            ],
            "isError": false,
          },
        },
        "lookalikeSite": {
          "id": 4,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Vault login "Shop" is for shop.example, but this tab is on https://shop.example.evil.test. Nothing was filled. Check you are on the right site.",
                "type": "text",
              },
            ],
            "isError": true,
          },
        },
        "notALogin": {
          "id": 6,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Vault item "Weather" is not a login, so it is never typed into a page.",
                "type": "text",
              },
            ],
            "isError": true,
          },
        },
        "password": {
          "id": 1,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Filled the password of vault login <login> into e4.",
                "type": "text",
              },
            ],
            "isError": false,
          },
        },
        "plainHttp": {
          "id": 5,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Vault login "Shop" is for shop.example, but this tab is on http://shop.example. Nothing was filled. Check you are on the right site.",
                "type": "text",
              },
            ],
            "isError": true,
          },
        },
        "unknownItem": {
          "id": 7,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "There is no vault item gone-item. Call list_vault_items for the current ones.",
                "type": "text",
              },
            ],
            "isError": true,
          },
        },
        "username": {
          "id": 3,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "Filled the username of vault login <login> into e4.",
                "type": "text",
              },
            ],
            "isError": false,
          },
        },
      },
      "values": {
        "codeIsSixDigits": true,
        "extra": 0,
        "password": true,
        "username": "shopper",
      },
    }
  `);
});

it('refuses vault secrets to a plugin whose manifest does not ask for the secrets permission', async () => {
  dataDir = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-peek-')));
  const pluginsDir = path.join(dataDir, 'user-plugins');
  await writeToolPlugin(
    pluginsDir,
    'peek',
    `import { defineToolPlugin, runPlugin } from ${JSON.stringify(PLUGIN_SDK_URL)};
runPlugin(() => defineToolPlugin({
  listTools: () => [{ name: 'grab', description: 'Asks for a password', inputSchema: { type: 'object' } }],
  callTool: async ({ input, resolveSecret }) => {
    const answer = await resolveSecret({ vaultId: input.vaultId, field: 'password', origin: 'https://shop.example' });
    return { kind: 'ok', content: [{ kind: 'text', text: JSON.stringify(answer) }] };
  },
}));`,
  );
  const host = await startChatFixture({ dataDir, builtinPluginsDir: PLUGIN_FIXTURES, pluginsDir, sequence: sequence() });
  chat = host;
  const login = VaultItem.parse((await host.host.call('POST', '/api/vault', { kind: 'login', label: 'Shop', site: 'shop.example', username: 'shopper', password: PASSWORD })).body);
  const thread = await host.thread(await host.agent());
  StartedSend.parse((await host.host.call('POST', `/api/threads/${thread.id}/messages`, { text: 'stall-polite', sessionChoice: { kind: 'auto' } })).body);
  const tools = await vi.waitFor(async () => {
    const saved = await savedTools(dataDir);
    if (saved.kind !== 'mcp') throw new Error('waiting for mcp host tools');
    return saved;
  });
  const answer = await postMcp(tools.url, tools.token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'peek_grab', arguments: { vaultId: login.id } } });
  expect({ leaked: JSON.stringify(answer.body).includes(PASSWORD), answer: answer.body }).toMatchInlineSnapshot(`
    {
      "answer": {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "{"kind":"refused","reason":"This plugin may not use the Secrets Vault (its manifest does not ask for the secrets permission)."}",
              "type": "text",
            },
          ],
          "isError": false,
        },
      },
      "leaked": false,
    }
  `);
});
