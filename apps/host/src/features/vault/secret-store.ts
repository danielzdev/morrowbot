/** Whether a secret was saved, or refused before anything was written because the store cannot hold one that long. */
export type SecretWrite = { readonly kind: 'saved' } | { readonly kind: 'too-long' };

/**
 * Where the vault keeps secret values, each under its item's id. Values are opaque strings here;
 * the vault service parses them. No method ever puts a value into an error message.
 */
export interface SecretStore {
  /** The value saved for `id`, or undefined when there is none. */
  read(id: string): Promise<string | undefined>;
  /** Saves `secret` for `id`, replacing any value saved before. */
  write(id: string, secret: string): Promise<SecretWrite>;
  /** Removes the value for `id`; removing one that is not there does nothing. */
  remove(id: string): Promise<void>;
}

export const SAVED: SecretWrite = { kind: 'saved' };

/** A store failed. The message names what failed, never a secret. */
export class SecretStoreError extends Error {
  override readonly name = 'SecretStoreError';
}
