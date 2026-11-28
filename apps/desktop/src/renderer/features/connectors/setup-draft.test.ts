import { expect, it } from 'vitest';
import { draftOf, newSetupOf, setupEditOf, EMPTY_STDIO } from './setup-draft.ts';

it('keeps saved secrets that are left blank, sets typed ones and drops removed names', () => {
  const draft = draftOf({ kind: 'stdio', command: 'notes-server', args: ['--folder', 'My Notes'], envNames: ['TOKEN', 'REGION', 'OLD'] });
  if (draft.kind !== 'stdio') throw new Error('expected a stdio draft');
  const [token, region] = draft.env;
  if (token === undefined || region === undefined) throw new Error('expected the saved rows');
  const edited = {
    ...draft,
    args: `${draft.args}\n--verbose\n\n`,
    env: [token, { ...region, value: 'eu' }, { key: 'new:1', name: 'EXTRA', value: '', saved: false }, { key: 'new:2', name: '', value: '', saved: false }],
  };
  expect(setupEditOf(edited)).toMatchInlineSnapshot(`
    {
      "kind": "ready",
      "value": {
        "args": [
          "--folder",
          "My Notes",
          "--verbose",
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
  const draft = draftOf({ kind: 'composio', toolkit: 'gmail', serverUrl: 'https://backend.composio.dev/v3/mcp/server', account: { kind: 'user', userId: 'me' } });
  if (draft.kind !== 'composio') throw new Error('expected a Composio draft');
  expect([setupEditOf(draft), setupEditOf({ ...draft, apiKey: 'next-key' })]).toMatchInlineSnapshot(`
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
