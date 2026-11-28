import { expect, it } from 'vitest';
import type { ConnectorSetupView } from '@morrowbot/contracts';
import { draftOf, newSetupOf, setupEditOf, EMPTY_STDIO, type SetupDraft } from './setup-draft.ts';

it('keeps saved secrets that are left blank, sets typed ones, drops removed names and sends saved arguments exactly', () => {
  const saved: Extract<ConnectorSetupView, { kind: 'stdio' }> = { kind: 'stdio', command: 'notes-server', args: ['--folder', 'My Notes', ''], envNames: ['TOKEN', 'REGION', 'OLD'] };
  const draft = draftOf(saved);
  if (draft.kind !== 'stdio') throw new Error('expected a stdio draft');
  const [token, region] = draft.env;
  if (token === undefined || region === undefined) throw new Error('expected the saved rows');
  const edited = {
    ...draft,
    env: [token, { ...region, value: 'eu' }, { key: 'new:1', name: 'EXTRA', value: '', saved: false }, { key: 'new:2', name: '', value: '', saved: false }],
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
  const saved: Extract<ConnectorSetupView, { kind: 'composio' }> = { kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/server', account: { kind: 'user', userId: 'me' } };
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
  const row = (name: string) => ({ key: name, name, value: 'x', saved: false });
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
  const stdio: Extract<ConnectorSetupView, { kind: 'stdio' }> = { kind: 'stdio', command: 'notes-server', args: ['--folder', 'Notes'], envNames: ['TOKEN'] };
  const http: Extract<ConnectorSetupView, { kind: 'http' }> = { kind: 'http', url: 'https://example.com/mcp', headerNames: ['Authorization'] };
  const composio: Extract<ConnectorSetupView, { kind: 'composio' }> = { kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/server', account: { kind: 'user', userId: 'me' } };
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
