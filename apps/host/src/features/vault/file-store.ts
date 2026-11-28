import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { writeFileAtomic } from './atomic-file.ts';
import { newMasterKey, readIfThere, type MasterKeyStore } from './master-key.ts';
import { SecretStoreError, type SecretStore } from './secret-store.ts';
import { serial } from './serial.ts';

const IV_BYTES = 12;
const TAG_BYTES = 16;

const Base64 = z.base64();
const Sealed = z.strictObject({ iv: Base64, tag: Base64, data: Base64 });
const SecretsFile = z.strictObject({ version: z.literal(1), secrets: z.record(z.string(), Sealed) });
type Sealed = z.infer<typeof Sealed>;

export interface FileStoreOptions {
  /** The sealed secrets: `<dataDir>/vault-secrets.json`. */
  readonly file: string;
  /** Keeps the one master key every value is sealed with; a key is made on first use unless one is saved already. */
  readonly keys: MasterKeyStore;
}

/**
 * Every secret value sealed with AES-256-GCM under one master key, in one JSON file written atomically (owner-only).
 * Each value gets a fresh 96-bit nonce and is bound to its reference as associated data, so an edited, truncated or
 * swapped value fails to open instead of turning into another secret. Removing never needs the key.
 */
export function encryptedFileStore(options: FileStoreOptions): SecretStore {
  const once = <T>(open: () => Promise<T>): (() => Promise<T>) => {
    let opened: Promise<T> | undefined;
    return () =>
      (opened ??= open().catch((error: unknown) => {
        opened = undefined;
        throw error;
      }));
  };
  const entries = once(() => readSecrets(options.file));
  const key = once(async () => {
    const saved = await options.keys.load();
    if (saved !== undefined) return saved;
    if ((await entries()).size > 0) throw new SecretStoreError('The vault key is missing, so the saved secrets cannot be opened');
    return options.keys.create(newMasterKey());
  });
  const inTurn = serial();
  const save = (secrets: ReadonlyMap<string, Sealed>): Promise<void> =>
    writeFileAtomic(options.file, `${JSON.stringify({ version: 1, secrets: Object.fromEntries(secrets) }, null, 2)}\n`);
  return {
    read: async (ref) => {
      const sealed = (await entries()).get(ref);
      return sealed === undefined ? undefined : unseal(await key(), ref, sealed);
    },
    write: (ref, secret) =>
      inTurn(async () => {
        const secrets = await entries();
        const sealed = seal(await key(), ref, secret);
        await save(new Map(secrets).set(ref, sealed));
        secrets.set(ref, sealed);
      }),
    remove: (ref) =>
      inTurn(async () => {
        const secrets = await entries();
        if (!secrets.has(ref)) return;
        const next = new Map(secrets);
        next.delete(ref);
        await save(next);
        secrets.delete(ref);
      }),
  };
}

async function readSecrets(file: string): Promise<Map<string, Sealed>> {
  const text = await readIfThere(file);
  if (text === undefined) return new Map();
  const parsed = SecretsFile.safeParse(parseJson(text));
  if (!parsed.success) throw new SecretStoreError('The vault secrets file is not one Ori Kami wrote');
  return new Map(Object.entries(parsed.data.secrets));
}

function seal(key: Buffer, ref: string, secret: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(ref, 'utf8'));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function unseal(key: Buffer, ref: string, sealed: Sealed): string {
  try {
    const iv = Buffer.from(sealed.iv, 'base64');
    const tag = Buffer.from(sealed.tag, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('bad sizes');
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(ref, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretStoreError(`The saved secret ${ref} failed its integrity check`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
