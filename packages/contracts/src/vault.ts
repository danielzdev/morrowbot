import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

/** What a vault item holds: a website login, an API key, or the value of one HTTP header. */
export const VaultItemKind = z.enum(['login', 'api_key', 'header_secret']);
export type VaultItemKind = z.infer<typeof VaultItemKind>;

/** The longest secret value (password, key or header value) the vault keeps. */
export const MAX_VAULT_SECRET = 16_384;

/** The name agents see the item by. */
const VaultLabel = z.string().trim().min(1).max(100);
/** The website or domain the item is for, such as `github.com`. */
const VaultSite = z.string().trim().min(1).max(253).nullable();
const VaultUsername = z.string().trim().min(1).max(256);
/** An HTTP header name (an RFC 9110 token), such as `Authorization` or `X-Api-Key`. */
const VaultHeaderName = z
  .string()
  .trim()
  .max(100)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, { error: 'Use a header name such as Authorization or X-Api-Key' });

/** A secret as typed: never trimmed, and never echoed back in an error. */
const VaultSecret = z
  .string()
  .min(1, { error: 'Enter the secret' })
  .max(MAX_VAULT_SECRET, { error: `Keep the secret under ${String(MAX_VAULT_SECRET)} characters` });

/**
 * An authenticator setup key in base32 (RFC 4648), as sites show it under "can't scan the code?".
 * Spaces, dashes and `=` padding are dropped and letters upper-cased.
 */
export const TwoStepKey = z
  .string()
  .transform((key) => key.replaceAll(/[\s=-]/g, '').toUpperCase())
  .refine((key) => /^[A-Z2-7]{16,128}$/.test(key), { error: 'Enter the setup key as 16 or more letters A–Z and digits 2–7' });

const common = { id: EntityId, label: VaultLabel, site: VaultSite, createdAt: Timestamp, updatedAt: Timestamp };

/** A vault item as everyone outside the host sees it: names only. Secret values never leave the host. */
export const VaultItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('login'), ...common, username: VaultUsername, hasTotp: z.boolean() }),
  z.strictObject({ kind: z.literal('api_key'), ...common }),
  z.strictObject({ kind: z.literal('header_secret'), ...common, headerName: VaultHeaderName }),
]);
export type VaultItem = z.infer<typeof VaultItem>;

export const VaultItemList = z.strictObject({ items: z.array(VaultItem) });
export type VaultItemList = z.infer<typeof VaultItemList>;

const createCommon = { label: VaultLabel, site: VaultSite.default(null) };

export const CreateVaultItemRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('login'),
    ...createCommon,
    username: VaultUsername,
    password: VaultSecret,
    twoStepKey: TwoStepKey.nullable().default(null),
  }),
  z.strictObject({ kind: z.literal('api_key'), ...createCommon, key: VaultSecret }),
  z.strictObject({ kind: z.literal('header_secret'), ...createCommon, headerName: VaultHeaderName, value: VaultSecret }),
]);
export type CreateVaultItemRequest = z.infer<typeof CreateVaultItemRequest>;

const updateCommon = { label: VaultLabel.optional(), site: VaultSite.optional() };

/** Changes to one item, which keeps its kind. A field left out stays as it is; `twoStepKey: null` removes the key. */
export const UpdateVaultItemRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('login'),
    ...updateCommon,
    username: VaultUsername.optional(),
    password: VaultSecret.optional(),
    twoStepKey: TwoStepKey.nullable().optional(),
  }),
  z.strictObject({ kind: z.literal('api_key'), ...updateCommon, key: VaultSecret.optional() }),
  z.strictObject({ kind: z.literal('header_secret'), ...updateCommon, headerName: VaultHeaderName.optional(), value: VaultSecret.optional() }),
]);
export type UpdateVaultItemRequest = z.infer<typeof UpdateVaultItemRequest>;
