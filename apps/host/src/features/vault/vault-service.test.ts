import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CreateVaultItemRequest, UpdateVaultItemRequest } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { encryptedFileStore } from './file-store.ts';
import { keyFileStore } from './master-key.ts';
import type { SecretStore } from './secret-store.ts';
import { openVault, type ResolvedVaultItem, type VaultSave, type VaultService } from './vault-service.ts';

let dir: string;
/** The sealed file sits in its own folder, so a test can make only that folder refuse writes. */
let sealedDir: string;
let secrets: SecretStore;
let errors: unknown[];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-'));
  sealedDir = path.join(dir, 'sealed');
  await mkdir(sealedDir);
  secrets = sealedStore();
  errors = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

const sealedStore = (): SecretStore => encryptedFileStore({ file: path.join(sealedDir, 'vault-secrets.json'), keys: keyFileStore(path.join(dir, 'vault.key')) });

async function storedValues(): Promise<number> {
  const text = await readFile(path.join(sealedDir, 'vault-secrets.json'), 'utf8');
  return Object.keys(z.object({ secrets: z.record(z.string(), z.unknown()) }).parse(JSON.parse(text)).secrets).length;
}

function stopsAt(step: 'write' | 'remove'): { readonly store: SecretStore; readonly reached: Promise<undefined> } {
  const inner = sealedStore();
  const reached = Promise.withResolvers<undefined>();
  const stop = async (): Promise<void> => {
    reached.resolve(undefined);
    await new Promise<void>(() => undefined);
  };
  return {
    reached: reached.promise,
    store: {
      read: (ref) => inner.read(ref),
      write: async (ref, secret) => {
        await inner.write(ref, secret);
        if (step === 'write') await stop();
      },
      remove: (ref) => (step === 'remove' ? stop() : inner.remove(ref)),
    },
  };
}

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
    storedValues: (await storedValues()),
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
      "storedValues": 2,
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
    files: ['sealed', 'vault.json', 'vault.key'],
    secretInMetadata: false,
  });
});

it('drops a deleted item even when erasing its value fails, and erases that value on the next open', async () => {
  const vault = await open();
  const id = idOf(await create(vault, { kind: 'api_key', label: 'Weather', key: 'wx-1' }));
  await chmod(sealedDir, 0o500);
  const deleted = await vault.delete(id).then(
    () => 'deleted',
    () => 'erase failed',
  );
  const listed = vault.list().length;
  const valuesLeft = (await storedValues());
  await chmod(sealedDir, 0o700);
  await open();
  expect({ deleted, listed, valuesLeft, valuesAfterReopen: (await storedValues()) }).toEqual({
    deleted: 'erase failed',
    listed: 0,
    valuesLeft: 1,
    valuesAfterReopen: 0,
  });
});

it('keeps the secret vault.json points at, and every value saved since, when a change is cut short before vault.json is saved', async () => {
  const id = idOf(await create(await open(), { kind: 'api_key', label: 'Weather', key: 'old' }));
  const updating = stopsAt('write');
  void update(await open(updating.store), id, { kind: 'api_key', key: 'new' });
  await updating.reached;
  const afterUpdate = await storedValues();
  const creating = stopsAt('write');
  void create(await open(creating.store), { kind: 'api_key', label: 'Search', key: 'never listed' });
  await creating.reached;
  const afterCreate = await storedValues();
  const reopened = await open(sealedStore());
  expect({ afterUpdate, afterCreate, listed: reopened.list().map(({ label }) => label), resolved: used(await reopened.resolve(id)), valuesAfterReopen: await storedValues() }).toEqual({
    afterUpdate: 2,
    afterCreate: 3,
    listed: ['Weather'],
    resolved: { label: 'Weather', key: 'old' },
    valuesAfterReopen: 3,
  });
});

it('erases the old value of a change cut short after vault.json is saved, and keeps the new one', async () => {
  const id = idOf(await create(await open(), { kind: 'api_key', label: 'Weather', key: 'old' }));
  const updating = stopsAt('remove');
  const cut = await open(updating.store);
  void update(cut, id, { kind: 'api_key', key: 'new' });
  await updating.reached;
  const reopened = await open(sealedStore());
  expect({ resolved: used(await reopened.resolve(id)), values: await storedValues() }).toEqual({ resolved: { label: 'Weather', key: 'new' }, values: 1 });
});

it('keeps the secrets of items an older restored vault.json does not list, so they are back when the newer file is put back', async () => {
  const file = path.join(dir, 'vault.json');
  const inner = sealedStore();
  const backups: string[] = [];
  const backedUp: SecretStore = {
    read: (ref) => inner.read(ref),
    write: async (ref, secret) => {
      backups.push(await readFile(file, 'utf8').catch(() => 'missing'));
      await inner.write(ref, secret);
    },
    remove: (ref) => inner.remove(ref),
  };
  const vault = await open(backedUp);
  const kept = idOf(await create(vault, { kind: 'api_key', label: 'Weather', key: 'kept' }));
  const added = idOf(await create(vault, { kind: 'api_key', label: 'Search', key: 'added later' }));
  const [, takenWhileSearchWasSaved = ''] = backups;
  const newer = z.object({ entries: z.array(z.unknown()) }).parse(JSON.parse(await readFile(file, 'utf8')));
  await writeFile(file, takenWhileSearchWasSaved);
  const restored = await open(sealedStore());
  const listed = restored.list().map(({ label }) => label);
  const valuesAfterRestore = await storedValues();
  await writeFile(file, JSON.stringify({ version: 1, entries: newer.entries }));
  const back = await open(sealedStore());
  expect({ listed, valuesAfterRestore, back: [used(await back.resolve(kept)), used(await back.resolve(added))] }).toEqual({
    listed: ['Weather'],
    valuesAfterRestore: 2,
    back: [
      { label: 'Weather', key: 'kept' },
      { label: 'Search', key: 'added later' },
    ],
  });
});

it('replaces a secret that can no longer be read, when the change names every part of it', async () => {
  const vault = await open();
  const login = idOf(await create(vault, { kind: 'login', label: 'Forge', username: 'robot', password: 'old', twoStepKey: 'JBSWY3DPEHPK3PXP' }));
  const key = idOf(await create(vault, { kind: 'api_key', label: 'Weather', key: 'old' }));
  const saved = z.object({ entries: z.array(z.object({ secretRef: z.string() })) }).parse(JSON.parse(await readFile(path.join(dir, 'vault.json'), 'utf8')));
  for (const { secretRef } of saved.entries) await secrets.remove(secretRef);
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

it('lists nothing and changes nothing while vault.json cannot be read, and keeps its secrets for when the file is fixed', async () => {
  const id = idOf(await create(await open(), { kind: 'api_key', label: 'Weather', key: 'kept' }));
  const file = path.join(dir, 'vault.json');
  const good = await readFile(file, 'utf8');
  const broken = '{"version": 1, "entries": [';
  await writeFile(file, broken);
  const closed = await open(sealedStore());
  const meanwhile = {
    list: closed.list(),
    create: await create(closed, { kind: 'api_key', label: 'New', key: 'new' }),
    update: await update(closed, id, { kind: 'api_key', key: 'new' }),
    delete: await closed.delete(id),
    resolve: await closed.resolve(id).catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
  };
  const reported = errors.splice(0).map((error) => (error instanceof Error ? error.message : String(error)));
  const untouched = (await readFile(file, 'utf8')) === broken;
  await writeFile(file, good);
  const fixed = await open(sealedStore());
  const reason = 'vault.json in the data folder is not a vault file MorrowBot can read; fix it or move it aside to start with an empty vault';
  expect({ meanwhile, reported, untouched, afterFix: used(await fixed.resolve(id)) }).toEqual({
    meanwhile: { list: [], create: { kind: 'invalid', reason }, update: { kind: 'invalid', reason }, delete: false, resolve: reason },
    reported: [`${file}: ${reason}`],
    untouched: true,
    afterFix: { label: 'Weather', key: 'kept' },
  });
});

it('opens empty while vault.json is moved aside, and erases nothing, so its secrets are back when it is put back', async () => {
  const id = idOf(await create(await open(), { kind: 'api_key', label: 'Weather', key: 'kept' }));
  const file = path.join(dir, 'vault.json');
  await rename(file, `${file}.aside`);
  const empty = await open(sealedStore());
  const listed = empty.list();
  await rename(`${file}.aside`, file);
  const back = await open(sealedStore());
  expect({ listed, back: used(await back.resolve(id)) }).toEqual({ listed: [], back: { label: 'Weather', key: 'kept' } });
});
