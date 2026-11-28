import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { VaultItem, type CreateVaultItemRequest, type UpdateVaultItemRequest, type VaultItemKind } from '@morrowbot/contracts';
import { z } from 'zod';
import { writeFileAtomic } from './atomic-file.ts';
import type { SecretStore } from './secret-store.ts';
import { SecretStoreError } from './secret-store.ts';
import { serial } from './serial.ts';
import { base32Bytes, totp } from './totp.ts';

/**
 * `<dataDir>/vault.json`: each item's names, and the reference its secret value is saved under in the `SecretStore`.
 * Every change to a secret saves the new value under a new reference first, so writing this file is the one moment a
 * change happens; values no entry points at (left by a change cut short) are erased when the vault opens.
 */
const Entry = z.strictObject({ item: VaultItem, secretRef: z.string().min(1).max(128) });
const VaultFile = z.strictObject({ version: z.literal(1), entries: z.array(Entry) });
type Entry = z.infer<typeof Entry>;

/** The secret part of an item, as the store keeps it (JSON). */
const Secret = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('login'), password: z.string(), twoStepKey: z.string().nullable() }),
  z.strictObject({ kind: z.literal('api_key'), key: z.string() }),
  z.strictObject({ kind: z.literal('header_secret'), value: z.string() }),
]);
type Secret = z.infer<typeof Secret>;

type Of<K extends VaultItemKind> = Extract<VaultItem, { kind: K }>;

/** An item with its secret, for host code that uses it at the moment of a request. Never send one to a client or a model. */
export type ResolvedVaultItem =
  | { readonly kind: 'login'; readonly item: Of<'login'>; readonly password: string; readonly oneTimeCode: (() => string) | null }
  | { readonly kind: 'api_key'; readonly item: Of<'api_key'>; readonly key: string }
  | { readonly kind: 'header_secret'; readonly item: Of<'header_secret'>; readonly value: string };

export type VaultSave = { readonly kind: 'saved'; readonly item: VaultItem } | { readonly kind: 'not-found' } | { readonly kind: 'invalid'; readonly reason: string };

export interface VaultService {
  /** Every item's names, oldest first. Holds no secret. */
  list(): VaultItem[];
  create(request: CreateVaultItemRequest): Promise<VaultSave>;
  update(id: string, request: UpdateVaultItemRequest): Promise<VaultSave>;
  delete(id: string): Promise<boolean>;
  /** The item with its secret, read from the store between changes; undefined for an unknown id. The host-only resolver port. */
  resolve(id: string): Promise<ResolvedVaultItem | undefined>;
}

export interface VaultOptions {
  /** `<dataDir>/vault.json`. */
  readonly file: string;
  readonly secrets: SecretStore;
  readonly newId: () => string;
  readonly now: () => string;
  /** What one-time codes are made for. Defaults to the system clock. */
  readonly clock?: () => number;
  readonly report: (error: unknown) => void;
  /** A new reference to save a secret value under. Defaults to a random UUID. */
  readonly newRef?: () => string;
}

const KIND_NAMES: Readonly<Record<VaultItemKind, string>> = { login: 'a login', api_key: 'an API key', header_secret: 'a header secret' };

/**
 * Loads `vault.json`, erases secret values no item points at, and serves the vault. A missing `vault.json` is an empty
 * vault that erases nothing, so values sealed for a file moved aside are still there when it is put back. A
 * `vault.json` that cannot be read is reported and left as it is: the vault then lists no items and refuses every
 * change, so no secret is erased or overwritten until the file is fixed or moved aside.
 */
export async function openVault(options: VaultOptions): Promise<VaultService> {
  const { secrets, newId, now, report } = options;
  const clock = options.clock ?? Date.now;
  const newRef = options.newRef ?? randomUUID;
  const loaded = await load(options.file);
  if (loaded.kind === 'unreadable') {
    report(new Error(`${options.file}: ${UNREADABLE}`));
    return closedVault(UNREADABLE);
  }
  let entries: Entry[] = loaded.kind === 'read' ? loaded.entries : [];
  const inTurn = serial();
  const persist = async (next: Entry[]): Promise<void> => {
    await writeFileAtomic(options.file, `${JSON.stringify({ version: 1, entries: next }, null, 2)}\n`);
    entries = next;
  };
  const entryOf = (id: string): Entry | undefined => entries.find(({ item }) => item.id === id);
  const readSecret = async ({ item, secretRef }: Entry): Promise<Secret> => {
    const text = await secrets.read(secretRef);
    const parsed = text === undefined ? undefined : Secret.safeParse(parseJson(text));
    if (parsed?.success !== true || parsed.data.kind !== item.kind) throw new SecretStoreError(`The vault has no readable secret for item ${item.id}`);
    return parsed.data;
  };
  const erase = (ref: string): Promise<void> => secrets.remove(ref).catch(report);

  if (loaded.kind === 'read') {
    try {
      const live = new Set(entries.map(({ secretRef }) => secretRef));
      for (const ref of await secrets.list()) if (!live.has(ref)) await erase(ref);
    } catch (error) {
      report(error);
    }
  }

  return {
    list: () => entries.map(({ item }) => item),
    create: (request) =>
      inTurn(async () => {
        const { item, secret } = created(request, newId(), now());
        const secretRef = newRef();
        await secrets.write(secretRef, JSON.stringify(secret));
        try {
          await persist([...entries, { item, secretRef }]);
        } catch (error) {
          await erase(secretRef);
          throw error;
        }
        return { kind: 'saved', item };
      }),
    update: (id, request) =>
      inTurn(async () => {
        const current = entryOf(id);
        if (current === undefined) return { kind: 'not-found' };
        if (current.item.kind !== request.kind) return { kind: 'invalid', reason: `This item is ${KIND_NAMES[current.item.kind]} and stays one` };
        const before = changesSecret(request) ? await readSecret(current).catch(() => null) : null;
        const change = updated(current.item, request, before, now());
        if (change.kind === 'invalid') return change;
        const secretRef = change.secret === null ? current.secretRef : newRef();
        if (change.secret !== null) await secrets.write(secretRef, JSON.stringify(change.secret));
        try {
          await persist(entries.map((entry) => (entry === current ? { item: change.item, secretRef } : entry)));
        } catch (error) {
          if (secretRef !== current.secretRef) await erase(secretRef);
          throw error;
        }
        if (secretRef !== current.secretRef) await erase(current.secretRef);
        return { kind: 'saved', item: change.item };
      }),
    delete: (id) =>
      inTurn(async () => {
        const current = entryOf(id);
        if (current === undefined) return false;
        await persist(entries.filter((entry) => entry !== current));
        await secrets.remove(current.secretRef);
        return true;
      }),
    resolve: (id) =>
      inTurn(async (): Promise<ResolvedVaultItem | undefined> => {
        const entry = entryOf(id);
        if (entry === undefined) return undefined;
        const { item } = entry;
        const secret = await readSecret(entry);
        switch (item.kind) {
          case 'login': {
            if (secret.kind !== 'login') return undefined;
            const key = secret.twoStepKey === null ? null : base32Bytes(secret.twoStepKey);
            return { kind: 'login', item, password: secret.password, oneTimeCode: key === null ? null : () => totp(key, clock()) };
          }
          case 'api_key':
            return secret.kind === 'api_key' ? { kind: 'api_key', item, key: secret.key } : undefined;
          case 'header_secret':
            return secret.kind === 'header_secret' ? { kind: 'header_secret', item, value: secret.value } : undefined;
        }
      }),
  };
}

function created(request: CreateVaultItemRequest, id: string, at: string): { readonly item: VaultItem; readonly secret: Secret } {
  const common = { id, label: request.label, site: request.site, createdAt: at, updatedAt: at };
  switch (request.kind) {
    case 'login':
      return {
        item: { kind: 'login', ...common, username: request.username, hasTotp: request.twoStepKey !== null },
        secret: { kind: 'login', password: request.password, twoStepKey: request.twoStepKey },
      };
    case 'api_key':
      return { item: { kind: 'api_key', ...common }, secret: { kind: 'api_key', key: request.key } };
    case 'header_secret':
      return { item: { kind: 'header_secret', ...common, headerName: request.headerName }, secret: { kind: 'header_secret', value: request.value } };
  }
}

function changesSecret(request: UpdateVaultItemRequest): boolean {
  switch (request.kind) {
    case 'login':
      return request.password !== undefined || request.twoStepKey !== undefined;
    case 'api_key':
      return request.key !== undefined;
    case 'header_secret':
      return request.value !== undefined;
  }
}

type Change = { readonly kind: 'changed'; readonly item: VaultItem; readonly secret: Secret | null } | { readonly kind: 'invalid'; readonly reason: string };

/**
 * The item after `request`, and its new secret when the request changes one. `before` is the secret saved now, or
 * null when it is missing or unreadable: a login can then only take a new secret that names both of its parts.
 */
function updated(current: VaultItem, request: UpdateVaultItemRequest, before: Secret | null, at: string): Change {
  const common = { label: request.label ?? current.label, site: request.site === undefined ? current.site : request.site, updatedAt: at };
  switch (request.kind) {
    case 'login': {
      if (current.kind !== 'login') return mismatch;
      const old = before?.kind === 'login' ? before : null;
      let secret: Secret | null = null;
      if (request.password !== undefined || request.twoStepKey !== undefined) {
        const password = request.password ?? old?.password;
        const twoStepKey = request.twoStepKey === undefined ? old?.twoStepKey : request.twoStepKey;
        if (password === undefined || twoStepKey === undefined) return unreadable;
        secret = { kind: 'login', password, twoStepKey };
      }
      return { kind: 'changed', item: { ...current, ...common, username: request.username ?? current.username, hasTotp: secret === null ? current.hasTotp : secret.twoStepKey !== null }, secret };
    }
    case 'api_key':
      if (current.kind !== 'api_key') return mismatch;
      return { kind: 'changed', item: { ...current, ...common }, secret: request.key === undefined ? null : { kind: 'api_key', key: request.key } };
    case 'header_secret':
      if (current.kind !== 'header_secret') return mismatch;
      return {
        kind: 'changed',
        item: { ...current, ...common, headerName: request.headerName ?? current.headerName },
        secret: request.value === undefined ? null : { kind: 'header_secret', value: request.value },
      };
  }
}

const mismatch: Change = { kind: 'invalid', reason: 'This item is of another kind' };
const unreadable: Change = {
  kind: 'invalid',
  reason: "This login's saved secret can't be read. Enter the password and the two-step key (or remove the key) to replace it.",
};

const UNREADABLE = 'vault.json in the data folder is not a vault file MorrowBot can read; fix it or move it aside to start with an empty vault';

type Loaded = { readonly kind: 'read'; readonly entries: Entry[] } | { readonly kind: 'missing' } | { readonly kind: 'unreadable' };

async function load(file: string): Promise<Loaded> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable' };
  }
  const parsed = VaultFile.safeParse(parseJson(text));
  return parsed.success ? { kind: 'read', entries: parsed.data.entries } : { kind: 'unreadable' };
}

/** The vault while `vault.json` cannot be read: no items, every change refused with `reason`, and no secret to read. */
function closedVault(reason: string): VaultService {
  const refused = (): Promise<VaultSave> => Promise.resolve({ kind: 'invalid', reason });
  return { list: () => [], create: refused, update: refused, delete: () => Promise.resolve(false), resolve: () => Promise.reject(new SecretStoreError(reason)) };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
