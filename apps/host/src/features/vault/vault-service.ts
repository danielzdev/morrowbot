import { readFile } from 'node:fs/promises';
import { VaultItem, type CreateVaultItemRequest, type UpdateVaultItemRequest, type VaultItemKind } from '@morrowbot/contracts';
import { z } from 'zod';
import { writeFileAtomic } from './atomic-file.ts';
import type { SecretStore } from './secret-store.ts';
import { SecretStoreError } from './secret-store.ts';
import { serial } from './serial.ts';
import { base32Bytes, totp } from './totp.ts';

/** `<dataDir>/vault.json`: the items' names and kinds only. Secret values live in the `SecretStore`. */
const VaultFile = z.strictObject({ version: z.literal(1), items: z.array(VaultItem) });

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
  /** The item with its secret, read from the store right now; undefined for an unknown id. */
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
}

const TOO_LONG = 'This secret is too long to save in the macOS Keychain. Shorten it and try again.';
const KIND_NAMES: Readonly<Record<VaultItemKind, string>> = { login: 'a login', api_key: 'an API key', header_secret: 'a header secret' };

/** Loads the vault's names from `vault.json` (a missing file is an empty vault) and serves them. */
export async function openVault(options: VaultOptions): Promise<VaultService> {
  const { secrets, newId, now } = options;
  const clock = options.clock ?? Date.now;
  let items = await load(options.file);
  const inTurn = serial();
  const persist = async (next: VaultItem[]): Promise<void> => {
    await writeFileAtomic(options.file, `${JSON.stringify({ version: 1, items: next }, null, 2)}\n`);
    items = next;
  };
  const readSecret = async (item: VaultItem): Promise<Secret> => {
    const text = await secrets.read(item.id);
    const parsed = text === undefined ? undefined : Secret.safeParse(parseJson(text));
    if (parsed?.success !== true || parsed.data.kind !== item.kind) throw new SecretStoreError(`The vault has no readable secret for item ${item.id}`);
    return parsed.data;
  };

  return {
    list: () => [...items],
    create: (request) =>
      inTurn(async () => {
        const at = now();
        const { item, secret } = created(request, newId(), at);
        if ((await secrets.write(item.id, JSON.stringify(secret))).kind === 'too-long') return { kind: 'invalid', reason: TOO_LONG };
        try {
          await persist([...items, item]);
        } catch (error) {
          await secrets.remove(item.id).catch(options.report);
          throw error;
        }
        return { kind: 'saved', item };
      }),
    update: (id, request) =>
      inTurn(async () => {
        const current = items.find((item) => item.id === id);
        if (current === undefined) return { kind: 'not-found' };
        if (current.kind !== request.kind) return { kind: 'invalid', reason: `This item is ${KIND_NAMES[current.kind]} and stays one` };
        const before = changesSecret(request) ? await readSecret(current) : null;
        const change = updated(current, request, before, now());
        if (change.kind === 'invalid') return change;
        if (change.secret !== null && (await secrets.write(id, JSON.stringify(change.secret))).kind === 'too-long') return { kind: 'invalid', reason: TOO_LONG };
        try {
          await persist(items.map((item) => (item.id === id ? change.item : item)));
        } catch (error) {
          if (before !== null) await secrets.write(id, JSON.stringify(before)).catch(options.report);
          throw error;
        }
        return { kind: 'saved', item: change.item };
      }),
    delete: (id) =>
      inTurn(async () => {
        if (!items.some((item) => item.id === id)) return false;
        await persist(items.filter((item) => item.id !== id));
        await secrets.remove(id).catch(options.report);
        return true;
      }),
    resolve: async (id) => {
      const item = items.find((each) => each.id === id);
      if (item === undefined) return undefined;
      const secret = await readSecret(item);
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
    },
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

/** The item after `request`, and its new secret when the request changes one (`before` is the secret saved now). */
function updated(current: VaultItem, request: UpdateVaultItemRequest, before: Secret | null, at: string): Change {
  const common = { label: request.label ?? current.label, site: request.site === undefined ? current.site : request.site, updatedAt: at };
  switch (request.kind) {
    case 'login': {
      if (current.kind !== 'login' || (before !== null && before.kind !== 'login')) return mismatch;
      const secret = before === null ? null : { ...before, password: request.password ?? before.password, twoStepKey: request.twoStepKey === undefined ? before.twoStepKey : request.twoStepKey };
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

async function load(file: string): Promise<VaultItem[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const parsed = VaultFile.safeParse(parseJson(text));
  if (!parsed.success) throw new Error(`${file} is not a vault file MorrowBot wrote; move it aside to start with an empty vault`);
  return parsed.data.items;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
