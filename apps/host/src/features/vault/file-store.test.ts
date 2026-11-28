import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { encryptedFileStore } from './file-store.ts';
import { keyFileStore, type MasterKeyStore } from './master-key.ts';

const SECRET = 'correct horse battery staple ✓';
const OnDisk = z.object({ secrets: z.record(z.string(), z.object({ iv: z.string(), tag: z.string(), data: z.string() })) });

let dir: string;
let keyFile: string;
let options: { readonly file: string; readonly keys: MasterKeyStore };
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-store-'));
  keyFile = path.join(dir, 'vault.key');
  options = { file: path.join(dir, 'vault-secrets.json'), keys: keyFileStore(keyFile) };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const failure = (work: Promise<unknown>): Promise<string> =>
  work.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

it('round-trips secrets through AES-256-GCM across a reopen, with nothing readable on disk', async () => {
  const store = encryptedFileStore(options);
  await store.write('item-1', SECRET);
  await store.write('item-2', 'second');
  await store.write('item-2', 'second, changed');
  await store.remove('item-3');
  const reopened = encryptedFileStore(options);
  const onDisk = await readFile(options.file, 'utf8');
  expect({
    reads: [await reopened.read('item-1'), await reopened.read('item-2'), await reopened.read('missing')],
    plaintextOnDisk: onDisk.includes('horse') || onDisk.includes('second'),
    fileModes: [(await stat(options.file)).mode & 0o777, (await stat(keyFile)).mode & 0o777].map((mode) => mode.toString(8)),
  }).toEqual({ reads: [SECRET, 'second, changed', undefined], plaintextOnDisk: false, fileModes: ['600', '600'] });
  await reopened.remove('item-1');
  expect(await encryptedFileStore(options).read('item-1')).toBeUndefined();
});

it('refuses a value that was edited, moved to another item, or opened with another key, without naming the secret', async () => {
  await encryptedFileStore(options).write('item-1', SECRET);
  await encryptedFileStore(options).write('item-2', 'other');
  const original = await readFile(options.file, 'utf8');
  const one = OnDisk.parse(JSON.parse(original)).secrets['item-1'];
  if (one === undefined) throw new Error('item-1 was not saved');
  const flipped = Buffer.from(one.data, 'base64');
  flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);
  const rewrite = (secrets: object) => writeFile(options.file, JSON.stringify({ version: 1, secrets }));

  await rewrite({ 'item-1': { ...one, data: flipped.toString('base64') } });
  const edited = await failure(encryptedFileStore(options).read('item-1'));
  await rewrite({ 'item-2': one });
  const moved = await failure(encryptedFileStore(options).read('item-2'));
  await writeFile(options.file, original);
  await writeFile(keyFile, Buffer.alloc(32, 7).toString('base64'));
  const otherKey = await failure(encryptedFileStore(options).read('item-1'));
  await rm(keyFile);
  const noKey = await failure(encryptedFileStore(options).read('item-1'));

  expect({ edited, moved, otherKey, noKey }).toEqual({
    edited: 'The saved secret item-1 failed its integrity check',
    moved: 'The saved secret item-2 failed its integrity check',
    otherKey: 'The saved secret item-1 failed its integrity check',
    noKey: 'The vault key is missing, so the saved secrets cannot be opened',
  });
});

it('lists and removes saved values without the key, and makes one key on first write', async () => {
  const saved: Buffer[] = [];
  const keys: MasterKeyStore = {
    kind: 'key-file',
    load: () => Promise.resolve(saved[0]),
    save: (key) => {
      saved.push(key);
      return Promise.resolve();
    },
  };
  const store = encryptedFileStore({ file: options.file, keys });
  await store.write('item-1', SECRET);
  await store.write('item-2', 'other');
  const keysMadeFirst = saved.length;
  saved.length = 0;
  const keyless = encryptedFileStore({ file: options.file, keys });
  const listed = await keyless.list();
  await keyless.remove('item-1');
  expect({ keysMadeFirst, listed, after: await keyless.list(), keysMadeSince: saved.length }).toEqual({ keysMadeFirst: 1, listed: ['item-1', 'item-2'], after: ['item-2'], keysMadeSince: 0 });
});
