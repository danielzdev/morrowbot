import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CreateVaultItemRequest, UpdateVaultItemRequest } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { encryptedFileStore } from './file-store.ts';
import { keychainStore } from './keychain-store.ts';
import type { SecretStore } from './secret-store.ts';
import { openVault, type ResolvedVaultItem, type VaultSave, type VaultService } from './vault-service.ts';

let dir: string;
let secrets: SecretStore;
let errors: unknown[];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-'));
  secrets = encryptedFileStore({ file: path.join(dir, 'vault-secrets.json'), keyFile: path.join(dir, 'vault.key') });
  errors = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

function open(store: SecretStore = secrets): Promise<VaultService> {
  let id = 0;
  let tick = 0;
  return openVault({
    file: path.join(dir, 'vault.json'),
    secrets: store,
    newId: () => `item-${String(++id)}`,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    clock: () => 59_000,
    report: (error) => errors.push(error),
  });
}

const savedFile = async (): Promise<unknown> => JSON.parse(await readFile(path.join(dir, 'vault.json'), 'utf8'));
const create = (vault: VaultService, request: unknown) => vault.create(CreateVaultItemRequest.parse(request));
const update = (vault: VaultService, id: string, request: unknown) => vault.update(id, UpdateVaultItemRequest.parse(request));

const idOf = (save: VaultSave): string => {
  if (save.kind !== 'saved') throw new Error(`not saved: ${save.kind}`);
  return save.item.id;
};

/** What a host-side caller gets: the secret, and the current one-time code instead of its seed. */
function used(resolved: ResolvedVaultItem | undefined): unknown {
  switch (resolved?.kind) {
    case undefined:
      return undefined;
    case 'login':
      return { label: resolved.item.label, password: resolved.password, code: resolved.oneTimeCode?.() ?? null };
    case 'api_key':
      return { label: resolved.item.label, key: resolved.key };
    case 'header_secret':
      return { label: resolved.item.label, header: `${resolved.item.headerName}: ${resolved.value}` };
  }
}

it('creates, updates and deletes items, keeping names in vault.json and secrets in the store across a reopen', async () => {
  const vault = await open();
  const login = idOf(
    await create(vault, { kind: 'login', label: 'Git forge', site: 'git.example', username: 'robot', password: 'hunter2', twoStepKey: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq' }),
  );
  const key = idOf(await create(vault, { kind: 'api_key', label: 'Weather API', key: 'wx-1' }));
  const header = idOf(await create(vault, { kind: 'header_secret', label: 'Search', site: 'search.example', headerName: 'X-Api-Key', value: 'sk-1' }));
  const changes = {
    passwordOnly: await update(vault, login, { kind: 'login', password: 'hunter3' }),
    labelOnly: await update(vault, key, { kind: 'api_key', label: 'Weather', site: 'weather.example' }),
    otherKind: await update(vault, key, { kind: 'login', username: 'x' }),
    unknown: await update(vault, 'nope', { kind: 'api_key', key: 'x' }),
  };
  const resolvedBefore = [used(await vault.resolve(login)), used(await vault.resolve(key)), used(await vault.resolve(header))];
  await update(vault, login, { kind: 'login', twoStepKey: null });
  const deleted = [await vault.delete(header), await vault.delete(header)];

  const reopened = await open();
  expect({
    changes,
    resolvedBefore,
    deleted,
    afterReopen: reopened.list(),
    resolvedAfter: [used(await reopened.resolve(login)), used(await reopened.resolve(header))],
    headerSecretLeft: await secrets.read(header),
  }).toMatchInlineSnapshot(`
    {
      "afterReopen": [
        {
          "createdAt": "2026-01-01T00:00:00.000Z",
          "hasTotp": false,
          "id": "item-1",
          "kind": "login",
          "label": "Git forge",
          "site": "git.example",
          "updatedAt": "2026-01-01T00:00:05.000Z",
          "username": "robot",
        },
        {
          "createdAt": "2026-01-01T00:00:01.000Z",
          "id": "item-2",
          "kind": "api_key",
          "label": "Weather",
          "site": "weather.example",
          "updatedAt": "2026-01-01T00:00:04.000Z",
        },
      ],
      "changes": {
        "labelOnly": {
          "item": {
            "createdAt": "2026-01-01T00:00:01.000Z",
            "id": "item-2",
            "kind": "api_key",
            "label": "Weather",
            "site": "weather.example",
            "updatedAt": "2026-01-01T00:00:04.000Z",
          },
          "kind": "saved",
        },
        "otherKind": {
          "kind": "invalid",
          "reason": "This item is an API key and stays one",
        },
        "passwordOnly": {
          "item": {
            "createdAt": "2026-01-01T00:00:00.000Z",
            "hasTotp": true,
            "id": "item-1",
            "kind": "login",
            "label": "Git forge",
            "site": "git.example",
            "updatedAt": "2026-01-01T00:00:03.000Z",
            "username": "robot",
          },
          "kind": "saved",
        },
        "unknown": {
          "kind": "not-found",
        },
      },
      "deleted": [
        true,
        false,
      ],
      "headerSecretLeft": undefined,
      "resolvedAfter": [
        {
          "code": null,
          "label": "Git forge",
          "password": "hunter3",
        },
        undefined,
      ],
      "resolvedBefore": [
        {
          "code": "287082",
          "label": "Git forge",
          "password": "hunter3",
        },
        {
          "key": "wx-1",
          "label": "Weather",
        },
        {
          "header": "X-Api-Key: sk-1",
          "label": "Search",
        },
      ],
    }
  `);
});

it('saves every one of many concurrent writes whole, leaving no temporary file and no secret in vault.json', async () => {
  const vault = await open();
  await Promise.all(Array.from({ length: 25 }, (_, n) => create(vault, { kind: 'api_key', label: `Key ${String(n)}`, key: `secret-value-${String(n)}` })));
  const names = (await open()).list().map(({ label }) => label);
  const files = await readdir(dir);
  const metadata = await readFile(path.join(dir, 'vault.json'), 'utf8');
  expect({ count: names.length, distinct: new Set(names).size, files: files.toSorted(), secretInMetadata: metadata.includes('secret-value') }).toEqual({
    count: 25,
    distinct: 25,
    files: ['vault-secrets.json', 'vault.json', 'vault.key'],
    secretInMetadata: false,
  });
});

it('refuses a secret too long for the Keychain before saving it', async () => {
  const vault = await open(keychainStore('com.legendarykoi.morrowbot.vault.never-written'));
  const tooLong = await create(vault, { kind: 'api_key', label: 'Huge', key: '✓'.repeat(2000) });
  expect({ tooLong, items: vault.list(), saved: await savedFile() }).toEqual({
    tooLong: { kind: 'invalid', reason: 'This secret is too long to save in the macOS Keychain. Shorten it and try again.' },
    items: [],
    saved: { version: 1, items: [], pending: [] },
  });
});

it('erases the secret before dropping the item, so a failed erase leaves the item to delete again', async () => {
  const vault = await open();
  const id = idOf(await create(vault, { kind: 'api_key', label: 'Weather', key: 'wx-1' }));
  const secretsFile = path.join(dir, 'vault-secrets.json');
  await rm(secretsFile);
  await mkdir(secretsFile);
  const failed = await vault.delete(id).then(
    () => 'deleted',
    () => 'refused',
  );
  const listedAfterFailure = vault.list().length;
  await rm(secretsFile, { recursive: true });
  expect({ failed, listedAfterFailure, retried: await vault.delete(id), secretLeft: await secrets.read(id), listed: (await open()).list() }).toEqual({
    failed: 'refused',
    listedAfterFailure: 1,
    retried: true,
    secretLeft: undefined,
    listed: [],
  });
});

it('erases, on the next open, a secret whose create was cut short before its item was saved', async () => {
  await secrets.write('item-9', JSON.stringify({ kind: 'api_key', key: 'orphan' }));
  await writeFile(path.join(dir, 'vault.json'), JSON.stringify({ version: 1, items: [], pending: ['item-9'] }));
  const vault = await open();
  expect({ items: vault.list(), orphan: await secrets.read('item-9'), saved: await savedFile() }).toEqual({
    items: [],
    orphan: undefined,
    saved: { version: 1, items: [], pending: [] },
  });
});

it('replaces a secret that can no longer be read, when the change names every part of it', async () => {
  const vault = await open();
  const login = idOf(await create(vault, { kind: 'login', label: 'Forge', username: 'robot', password: 'old', twoStepKey: 'JBSWY3DPEHPK3PXP' }));
  const key = idOf(await create(vault, { kind: 'api_key', label: 'Weather', key: 'old' }));
  await secrets.remove(login);
  await secrets.remove(key);
  expect({
    passwordOnly: await update(vault, login, { kind: 'login', password: 'new' }),
    wholeLogin: (await update(vault, login, { kind: 'login', password: 'new', twoStepKey: null })).kind,
    apiKey: (await update(vault, key, { kind: 'api_key', key: 'new' })).kind,
    resolved: [used(await vault.resolve(login)), used(await vault.resolve(key))],
  }).toEqual({
    passwordOnly: { kind: 'invalid', reason: "This login's saved secret can't be read. Enter the password and the two-step key (or remove the key) to replace it." },
    wholeLogin: 'saved',
    apiKey: 'saved',
    resolved: [
      { label: 'Forge', password: 'new', code: null },
      { label: 'Weather', key: 'new' },
    ],
  });
});
