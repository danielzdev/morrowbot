import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { writeFileAtomic } from './atomic-file.ts';
import { SAVED, SecretStoreError, type SecretStore } from './secret-store.ts';
import { serial } from './serial.ts';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const Base64 = z.base64();
const Sealed = z.strictObject({ iv: Base64, tag: Base64, data: Base64 });
const SecretsFile = z.strictObject({ version: z.literal(1), secrets: z.record(z.string(), Sealed) });
type Sealed = z.infer<typeof Sealed>;

export interface FileStoreOptions {
  /** The sealed secrets, such as `<dataDir>/vault-secrets.json`. */
  readonly file: string;
  /** The 256-bit key, made on first use, such as `<dataDir>/vault.key`. */
  readonly keyFile: string;
}

/**
 * Secrets sealed with AES-256-GCM in one JSON file, for computers without a Keychain (Linux, CI, tests).
 * Each value gets a fresh 96-bit nonce and is bound to its item id, so an edited, truncated or swapped
 * value fails to open instead of turning into another secret. The key lives in its own owner-only file:
 * this keeps secrets out of copies of the secrets file alone, not from someone who can read the data folder.
 */
export function encryptedFileStore(options: FileStoreOptions): SecretStore {
  let opened: Promise<{ readonly key: Buffer; readonly secrets: Map<string, Sealed> }> | undefined;
  const state = () =>
    (opened ??= openStore(options).catch((error: unknown) => {
      opened = undefined;
      throw error;
    }));
  const inTurn = serial();
  const save = async (secrets: Map<string, Sealed>): Promise<void> => {
    await writeFileAtomic(options.file, `${JSON.stringify({ version: 1, secrets: Object.fromEntries(secrets) }, null, 2)}\n`);
  };
  return {
    read: async (id) => {
      const { key, secrets } = await state();
      const sealed = secrets.get(id);
      return sealed === undefined ? undefined : unseal(key, id, sealed);
    },
    write: (id, secret) =>
      inTurn(async () => {
        const { key, secrets } = await state();
        const sealed = seal(key, id, secret);
        await save(new Map(secrets).set(id, sealed));
        secrets.set(id, sealed);
        return SAVED;
      }),
    remove: (id) =>
      inTurn(async () => {
        const { secrets } = await state();
        if (!secrets.has(id)) return;
        const next = new Map(secrets);
        next.delete(id);
        await save(next);
        secrets.delete(id);
      }),
  };
}

async function openStore(options: FileStoreOptions): Promise<{ readonly key: Buffer; readonly secrets: Map<string, Sealed> }> {
  const text = await readIfThere(options.file);
  let secrets = new Map<string, Sealed>();
  if (text !== undefined) {
    const parsed = SecretsFile.safeParse(parseJson(text));
    if (!parsed.success) throw new SecretStoreError('The vault secrets file is not one MorrowBot wrote');
    secrets = new Map(Object.entries(parsed.data.secrets));
  }
  const keyText = await readIfThere(options.keyFile);
  if (keyText === undefined && secrets.size > 0) throw new SecretStoreError('The vault key file is missing, so its saved secrets cannot be opened');
  return { key: keyText === undefined ? await makeKey(options.keyFile) : keyOf(keyText), secrets };
}

async function makeKey(keyFile: string): Promise<Buffer> {
  const key = randomBytes(KEY_BYTES);
  await writeFile(keyFile, `${key.toString('base64')}\n`, { flag: 'wx', mode: 0o600 });
  return key;
}

function keyOf(text: string): Buffer {
  const key = Buffer.from(text.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new SecretStoreError('The vault key file does not hold a 256-bit key');
  return key;
}

function seal(key: Buffer, id: string, secret: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(id, 'utf8'));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function unseal(key: Buffer, id: string, sealed: Sealed): string {
  try {
    const iv = Buffer.from(sealed.iv, 'base64');
    const tag = Buffer.from(sealed.tag, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('bad sizes');
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(id, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretStoreError(`The saved secret for vault item ${id} failed its integrity check`);
  }
}

async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
