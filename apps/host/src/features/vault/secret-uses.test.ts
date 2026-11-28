import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CreateVaultItemRequest, type SecretField } from '@morrowbot/contracts';
import { afterEach, expect, it } from 'vitest';
import { encryptedFileStore } from './file-store.ts';
import { keyFileStore } from './master-key.ts';
import { loginFill, siteMatches } from './secret-uses.ts';
import { openVault } from './vault-service.ts';

let dir = '';
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('fills each part of a login, with the RFC 6238 code for the moment, and nothing for a login without a site or key', async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-uses-'));
  let id = 0;
  const vault = await openVault({
    file: path.join(dir, 'vault.json'),
    secrets: encryptedFileStore({ file: path.join(dir, 'vault-secrets.json'), keys: keyFileStore(path.join(dir, 'vault.key')) }),
    newId: () => `item-${String(++id)}`,
    now: () => '2026-01-01T00:00:00.000Z',
    clock: () => 59_000,
    report: (error) => {
      throw error;
    },
  });
  const add = (request: object): Promise<unknown> => vault.create(CreateVaultItemRequest.parse(request));
  await add({ kind: 'login', label: 'Forge', site: 'git.example', username: 'robot', password: 'pw-forge', twoStepKey: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
  await add({ kind: 'login', label: 'No site', username: 'robot', password: 'pw-nosite' });
  await add({ kind: 'login', label: 'No key', site: 'https://wiki.example:8443', username: 'robot', password: 'pw-nokey' });
  const fill = (vaultId: string, field: SecretField, origin: string) => loginFill(vault, { vaultId, field, origin });
  expect({
    username: await fill('item-1', 'username', 'https://git.example'),
    password: await fill('item-1', 'password', 'https://git.example'),
    code: await fill('item-1', 'one-time-code', 'https://git.example'),
    noSite: await fill('item-2', 'password', 'https://git.example'),
    noKey: await fill('item-3', 'one-time-code', 'https://wiki.example:8443'),
  }).toMatchInlineSnapshot(`
    {
      "code": {
        "kind": "value",
        "value": "287082",
      },
      "noKey": {
        "kind": "refused",
        "reason": "Vault login "No key" has no authenticator key. Ask the person for the code (request a takeover).",
      },
      "noSite": {
        "kind": "refused",
        "reason": "Vault login "No site" has no website saved, so it is filled nowhere. Ask the person to add its site in Settings › Vault.",
      },
      "password": {
        "kind": "value",
        "value": "pw-forge",
      },
      "username": {
        "kind": "value",
        "value": "robot",
      },
    }
  `);
});

it('matches a page to a saved site by host, subdomain, and any scheme or port the site names', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['git.example', 'https://git.example'],
    ['git.example', 'https://login.git.example'],
    ['git.example', 'https://evilgit.example'],
    ['git.example', 'https://git.example.evil.test'],
    ['git.example', 'http://git.example'],
    ['Git.Example/login', 'https://git.example'],
    ['localhost', 'http://localhost:3000'],
    ['https://wiki.example:8443', 'https://wiki.example:8443'],
    ['https://wiki.example:8443', 'https://wiki.example'],
    ['http://intranet.example', 'http://intranet.example'],
    ['http://intranet.example', 'https://intranet.example'],
    ['git.example', 'https://git.example/path'],
  ];
  expect(cases.map(([site, origin]) => `${siteMatches(site, origin) ? 'fill' : 'refuse'}  ${site} on ${origin}`)).toMatchInlineSnapshot(`
    [
      "fill  git.example on https://git.example",
      "fill  git.example on https://login.git.example",
      "refuse  git.example on https://evilgit.example",
      "refuse  git.example on https://git.example.evil.test",
      "refuse  git.example on http://git.example",
      "fill  Git.Example/login on https://git.example",
      "fill  localhost on http://localhost:3000",
      "fill  https://wiki.example:8443 on https://wiki.example:8443",
      "refuse  https://wiki.example:8443 on https://wiki.example",
      "fill  http://intranet.example on http://intranet.example",
      "refuse  http://intranet.example on https://intranet.example",
      "refuse  git.example on https://git.example/path",
    ]
  `);
});
