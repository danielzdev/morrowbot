/**
 * The vault's backend for secret values: the seam a future password-manager backend plugs into. Values are opaque
 * strings, each under a reference the vault service picks; no method ever puts a value into an error message.
 */
export interface SecretStore {
  /** The value saved under `ref`, or undefined when there is none. */
  read(ref: string): Promise<string | undefined>;
  /** Saves `secret` under `ref`, replacing any value saved there. */
  write(ref: string, secret: string): Promise<void>;
  /** Removes the value under `ref`; removing one that is not there does nothing. */
  remove(ref: string): Promise<void>;
}

/** A store failed. The message names what failed, never a secret. */
export class SecretStoreError extends Error {
  override readonly name = 'SecretStoreError';
}
