import { expect, it } from 'vitest';
import { ConfigReadResponse, GetAccountResponse } from './protocol.ts';
import { judgeRoute } from './route.ts';

const account = (routing: Readonly<Record<string, unknown>> | null, overrides: Readonly<Record<string, unknown>> = {}): GetAccountResponse =>
  GetAccountResponse.parse({
    account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus', workspaceName: null },
    userId: 'user-1',
    requiresOpenaiAuth: true,
    workspaceRouting: routing === null ? null : { chatgptAccountId: 'ws-1', backendOrigin: 'https://chatgpt.com', accountRoutingOverride: 'NO_CONSTRAINT', ...routing },
    ...overrides,
  });

const config = (overrides: Readonly<Record<string, unknown>> = {}): ReturnType<typeof ConfigReadResponse.parse>['config'] =>
  ConfigReadResponse.parse({ config: { model_provider: null, openai_base_url: null, chatgpt_base_url: null, model_providers: {}, mcp_servers: {}, ...overrides } }).config;

/** The route a snapshot resolves to, with each key shown as a short letter shared by equal keys. */
async function judgeAll(cases: Readonly<Record<string, readonly [GetAccountResponse, ReturnType<typeof config>]>>): Promise<unknown> {
  const names = new Map<string, string>();
  const short = (key: string): string => {
    if (key === '') return "''";
    if (!names.has(key)) names.set(key, String.fromCharCode(65 + names.size));
    return names.get(key) ?? key;
  };
  const out: Record<string, unknown> = {};
  for (const [name, [read, cfg]] of Object.entries(cases)) {
    const judged = await judgeRoute(read, cfg);
    switch (judged.kind) {
      case 'failed':
        out[name] = judged;
        break;
      case 'signed-out':
        out[name] = { kind: 'signed-out', routeKey: `route ${short(judged.routeKey)}` };
        break;
      case 'resolved':
        out[name] = { route: judged.route.kind, account: `account ${short(judged.accountKey)}`, routeKey: `route ${short(judged.routeKey)}`, label: judged.accountLabel };
        break;
    }
  }
  return out;
}

it('keys the account by user and workspace, and the route by everything that decides where inference goes', async () => {
  expect(
    await judgeAll({
      native: [account({}), config()],
      sameEmailOtherWorkspace: [account({ chatgptAccountId: 'ws-2' }), config()],
      explicitDefaults: [account({}), config({ chatgpt_base_url: 'https://ChatGPT.com/backend-api/', openai_base_url: 'https://chatgpt.com/backend-api/codex/' })],
      otherBackendOrigin: [account({ backendOrigin: 'https://us.chatgpt.com' }), config()],
      routingOverride: [account({ accountRoutingOverride: 'ENFORCE' }), config()],
      gatewayA: [account({}), config({ chatgpt_base_url: 'https://gateway.example.com/a/' })],
      gatewayB: [account({}), config({ chatgpt_base_url: 'https://gateway.example.com/b/' })],
      platformApi: [account({}), config({ openai_base_url: 'https://api.openai.com/v1' })],
      customProvider: [account({}), config({ model_provider: 'local', model_providers: { local: { base_url: 'http://localhost:1234/v1' } } })],
      noWorkspace: [account(null), config()],
      noIdentity: [account({}, { userId: null, account: { type: 'chatgpt', email: null, planType: 'team', workspaceName: 'Acme' } }), config()],
      apiKey: [account(null, { account: { type: 'apiKey' }, userId: null }), config()],
      signedOut: [account(null, { account: null, userId: null }), config()],
    }),
  ).toMatchInlineSnapshot(`
    {
      "apiKey": {
        "account": "account ''",
        "label": "OpenAI API key",
        "route": "stateless",
        "routeKey": "route K",
      },
      "customProvider": {
        "account": "account ''",
        "label": "ChatGPT Plus",
        "route": "stateless",
        "routeKey": "route I",
      },
      "explicitDefaults": {
        "account": "account A",
        "label": "ChatGPT Plus",
        "route": "subscription",
        "routeKey": "route B",
      },
      "gatewayA": {
        "account": "account ''",
        "label": "ChatGPT Plus",
        "route": "stateless",
        "routeKey": "route F",
      },
      "gatewayB": {
        "account": "account ''",
        "label": "ChatGPT Plus",
        "route": "stateless",
        "routeKey": "route G",
      },
      "native": {
        "account": "account A",
        "label": "ChatGPT Plus",
        "route": "subscription",
        "routeKey": "route B",
      },
      "noIdentity": {
        "account": "account ''",
        "label": "ChatGPT Business (Acme)",
        "route": "unidentified",
        "routeKey": "route B",
      },
      "noWorkspace": {
        "account": "account ''",
        "label": "ChatGPT Plus",
        "route": "unidentified",
        "routeKey": "route J",
      },
      "otherBackendOrigin": {
        "account": "account A",
        "label": "ChatGPT Plus",
        "route": "subscription",
        "routeKey": "route D",
      },
      "platformApi": {
        "account": "account ''",
        "label": "ChatGPT Plus",
        "route": "stateless",
        "routeKey": "route H",
      },
      "routingOverride": {
        "account": "account A",
        "label": "ChatGPT Plus",
        "route": "subscription",
        "routeKey": "route E",
      },
      "sameEmailOtherWorkspace": {
        "account": "account C",
        "label": "ChatGPT Plus",
        "route": "subscription",
        "routeKey": "route B",
      },
      "signedOut": {
        "kind": "signed-out",
        "routeKey": "route L",
      },
    }
  `);
});
