import { expect, it } from 'vitest';
import type { ConnectorSetupView } from '@morrowbot/contracts';
import { draftOf, newSetupOf, setupEditOf, withSource, EMPTY_STDIO, type SecretRow, type SetupDraft } from './setup-draft.ts';

const blank = (key: string, name: string): SecretRow => ({ key, name, value: '', source: { kind: 'typed' }, saved: false });
const inline = (name: string) => ({ kind: 'inline', name }) as const;

it('keeps saved secrets that are left blank, sets typed ones, drops removed names and sends saved arguments exactly', () => {
  const saved: Extract<ConnectorSetupView, { kind: 'stdio' }> = { kind: 'stdio', command: 'notes-server', args: ['--folder', 'My Notes', ''], env: [inline('TOKEN'), inline('REGION'), inline('OLD')] };
  const draft = draftOf(saved);
  if (draft.kind !== 'stdio') throw new Error('expected a stdio draft');
  const [token, region] = draft.env;
  if (token === undefined || region === undefined) throw new Error('expected the saved rows');
  const edited = {
    ...draft,
    env: [token, { ...region, value: 'eu' }, blank('new:1', 'EXTRA'), blank('new:2', '')],
  };
  expect(setupEditOf(edited, saved)).toMatchInlineSnapshot(`
    {
      "kind": "ready",
      "value": {
        "args": [
          "--folder",
          "My Notes",
          "",
        ],
        "command": "notes-server",
        "env": [
          {
            "kind": "keep",
            "name": "TOKEN",
          },
          {
            "kind": "set",
            "name": "REGION",
            "value": "eu",
          },
          {
            "kind": "set",
            "name": "EXTRA",
            "value": "",
          },
        ],
        "kind": "stdio",
      },
    }
  `);
});

it('keeps a saved Composio key until a new one is typed', () => {
  const saved: Extract<ConnectorSetupView, { kind: 'composio' }> = { kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/server', apiKey: { kind: 'inline' }, account: { kind: 'user', userId: 'me' } };
  const draft = draftOf(saved);
  if (draft.kind !== 'composio') throw new Error('expected a Composio draft');
  expect([setupEditOf(draft, saved), setupEditOf({ ...draft, apiKey: 'next-key' }, saved)]).toMatchInlineSnapshot(`
    [
      {
        "kind": "ready",
        "value": {
          "account": {
            "kind": "user",
            "userId": "me",
          },
          "apiKey": {
            "kind": "keep",
          },
          "kind": "composio",
          "serverUrl": "https://backend.composio.dev/v3/mcp/server",
          "toolkit": "gmail",
        },
      },
      {
        "kind": "ready",
        "value": {
          "account": {
            "kind": "user",
            "userId": "me",
          },
          "apiKey": {
            "kind": "set",
            "value": "next-key",
          },
          "kind": "composio",
          "serverUrl": "https://backend.composio.dev/v3/mcp/server",
          "toolkit": "gmail",
        },
      },
    ]
  `);
});

it('says why a new setup is not ready, and nothing while a required field is just empty', () => {
  const row = (name: string): SecretRow => ({ key: name, name, value: 'x', source: { kind: 'typed' }, saved: false });
  expect([
    newSetupOf(EMPTY_STDIO),
    newSetupOf({ ...EMPTY_STDIO, command: 'run', env: [row('1BAD')] }),
    newSetupOf({ ...EMPTY_STDIO, command: 'run', env: [row('')] }),
    newSetupOf({ kind: 'http', url: 'ftp://example.com', headers: [] }),
    newSetupOf({ kind: 'http', url: 'https://example.com/mcp', headers: [row('Authorization'), row('authorization')] }),
  ]).toMatchInlineSnapshot(`
    [
      {
        "kind": "invalid",
        "reason": null,
      },
      {
        "kind": "invalid",
        "reason": "Use letters, digits and _ for a variable name",
      },
      {
        "kind": "invalid",
        "reason": "Give every variable a name.",
      },
      {
        "kind": "invalid",
        "reason": "Enter an http or https URL.",
      },
      {
        "kind": "invalid",
        "reason": "Name each header once",
      },
    ]
  `);
});

it('asks for every secret again once the connector points somewhere new', () => {
  const stdio: Extract<ConnectorSetupView, { kind: 'stdio' }> = { kind: 'stdio', command: 'notes-server', args: ['--folder', 'Notes'], env: [inline('TOKEN')] };
  const http: Extract<ConnectorSetupView, { kind: 'http' }> = { kind: 'http', url: 'https://example.com/mcp', headers: [inline('Authorization')] };
  const composio: Extract<ConnectorSetupView, { kind: 'composio' }> = { kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/server', apiKey: { kind: 'inline' }, account: { kind: 'user', userId: 'me' } };
  const outcome = (draft: SetupDraft, saved: ConnectorSetupView): string => {
    const edit = setupEditOf(draft, saved);
    return edit.kind === 'ready' ? 'ready' : String(edit.reason);
  };
  const stdioDraft = draftOf(stdio);
  const httpDraft = draftOf(http);
  const composioDraft = draftOf(composio);
  if (stdioDraft.kind !== 'stdio' || httpDraft.kind !== 'http' || composioDraft.kind !== 'composio') throw new Error('expected matching drafts');
  const typed = stdioDraft.env.map((row) => ({ ...row, value: 'new-token' }));
  expect({
    newArgsKeptToken: outcome({ ...stdioDraft, args: '--folder\nWork' }, stdio),
    newArgsTypedToken: outcome({ ...stdioDraft, args: '--folder\nWork', env: typed }, stdio),
    newUrlKeptHeader: outcome({ ...httpDraft, url: 'https://example.org/mcp' }, http),
    sameUrlKeptHeader: outcome({ ...httpDraft, url: ' https://example.com/mcp ' }, http),
    newAccountKeptKey: outcome({ ...composioDraft, accountId: 'someone-else' }, composio),
    newAccountTypedKey: outcome({ ...composioDraft, accountId: 'someone-else', apiKey: 'next-key' }, composio),
  }).toMatchInlineSnapshot(`
    {
      "newAccountKeptKey": "This points the connector somewhere new: enter its keys and secret values again.",
      "newAccountTypedKey": "ready",
      "newArgsKeptToken": "This points the connector somewhere new: enter its keys and secret values again.",
      "newArgsTypedToken": "ready",
      "newUrlKeptHeader": "This points the connector somewhere new: enter its keys and secret values again.",
      "sameUrlKeptHeader": "ready",
    }
  `);
});

it('sends Vault choices as chosen, names an empty header after its header secret, and never keeps a Vault row', () => {
  const unnamed: SecretRow = { key: 'new:1', name: '', value: 'typed-then-dropped', source: { kind: 'typed' }, saved: false };
  const header = withSource(unnamed, { kind: 'vault', vaultId: 'vault-1' }, 'X-Api-Key');
  const named = withSource({ ...unnamed, name: 'Authorization' }, { kind: 'vault', vaultId: 'vault-2' }, 'X-Api-Key');
  const draft: SetupDraft = { kind: 'http', url: 'https://example.com/mcp', headers: [header, named] };
  const saved: Extract<ConnectorSetupView, { kind: 'http' }> = {
    kind: 'http',
    url: 'https://example.com/mcp',
    headers: [{ kind: 'vault', name: 'X-Api-Key', vaultId: 'vault-1' }, { kind: 'vault', name: 'Authorization', vaultId: 'vault-2' }],
  };
  expect({ added: newSetupOf(draft), unchanged: setupEditOf(draftOf(saved), { ...saved, url: 'https://example.org/mcp' }), composio: newSetupOf({ kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/server', apiKey: '', keySaved: false, keySource: { kind: 'vault', vaultId: 'vault-3' }, accountKind: 'user', accountId: 'me' }) }).toMatchInlineSnapshot(`
    {
      "added": {
        "kind": "ready",
        "value": {
          "headers": [
            {
              "kind": "vault",
              "name": "X-Api-Key",
              "vaultId": "vault-1",
            },
            {
              "kind": "vault",
              "name": "Authorization",
              "vaultId": "vault-2",
            },
          ],
          "kind": "http",
          "url": "https://example.com/mcp",
        },
      },
      "composio": {
        "kind": "ready",
        "value": {
          "account": {
            "kind": "user",
            "userId": "me",
          },
          "apiKey": {
            "kind": "vault",
            "vaultId": "vault-3",
          },
          "kind": "composio",
          "serverUrl": "https://backend.composio.dev/v3/mcp/server",
          "toolkit": "gmail",
        },
      },
      "unchanged": {
        "kind": "ready",
        "value": {
          "headers": [
            {
              "kind": "vault",
              "name": "X-Api-Key",
              "vaultId": "vault-1",
            },
            {
              "kind": "vault",
              "name": "Authorization",
              "vaultId": "vault-2",
            },
          ],
          "kind": "http",
          "url": "https://example.com/mcp",
        },
      },
    }
  `);
});
