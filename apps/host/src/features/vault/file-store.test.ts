import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { encryptedFileStore } from './file-store.ts';
import { vaultBackend } from './index.ts';
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

it('removes saved values without the key, and makes one key on first write', async () => {
  const saved: Buffer[] = [];
  const keys: MasterKeyStore = {
    kind: 'key-file',
    load: () => Promise.resolve(saved[0]),
    create: (key) => {
      saved.push(key);
      return Promise.resolve(key);
    },
  };
  const store = encryptedFileStore({ file: options.file, keys });
  await store.write('item-1', SECRET);
  await store.write('item-2', 'other');
  const keysMadeFirst = saved.length;
  saved.length = 0;
  const keyless = encryptedFileStore({ file: options.file, keys });
  await keyless.remove('item-1');
  const after = Object.keys(OnDisk.parse(JSON.parse(await readFile(options.file, 'utf8'))).secrets);
  expect({ keysMadeFirst, after, keysMadeSince: saved.length }).toEqual({ keysMadeFirst: 1, after: ['item-2'], keysMadeSince: 0 });
});

it('gives two data folders opening at once the same key, so neither replaces the one the other sealed with', async () => {
  const shared = keyFileStore(keyFile);
  const folders = [path.join(dir, 'a.json'), path.join(dir, 'b.json')];
  await Promise.all(folders.map((file, n) => encryptedFileStore({ file, keys: shared }).write('item-1', `secret ${String(n)}`)));
  const reads = await Promise.all(folders.map((file) => encryptedFileStore({ file, keys: keyFileStore(keyFile) }).read('item-1')));
  expect(reads).toEqual(['secret 0', 'secret 1']);
});

it('deletes the temporary files a crash mid-write left beside the vault files, and nothing else', async () => {
  const left = ['vault-secrets.json.0123456789ab.tmp', 'vault.key.ba9876543210.tmp', 'vault.json.abcdefabcdef.tmp'];
  const kept = ['notes.0123456789ab.tmp', 'vault.json'];
  await Promise.all([...left, ...kept].map((name) => writeFile(path.join(dir, name), 'x')));
  await vaultBackend('file', process.platform, dir);
  expect((await readdir(dir)).toSorted()).toEqual(kept.toSorted());
});
