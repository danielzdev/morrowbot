import { SecretField } from '@morrowbot/contracts';
import { z } from '@morrowbot/plugin-sdk';

/**
 * What the agent may say about a secret: which vault entry and which part of it. Never the value.
 * The Secrets Vault (Milestone 2) plugs in as a `SecretSource`.
 */
export const SecretRequest = z.strictObject({
  entryId: z.string().min(1).describe('The vault entry, as the vault lists it'),
  field: SecretField,
});
export type SecretRequest = z.infer<typeof SecretRequest>;

export type SecretResolution =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Resolves a secret for one page origin, outside the model. The vault decides whether the entry
 * may be used on `origin`; the value goes straight to the browser and is never shown to the agent.
 */
export interface SecretSource {
  resolve(request: SecretRequest & { readonly origin: string }): Promise<SecretResolution>;
}

/** Until the vault ships, every secret is refused. */
export const noSecretSource: SecretSource = {
  resolve: () =>
    Promise.resolve({
      kind: 'refused',
      reason: 'The Secrets Vault is not set up yet. Ask the person to fill this field (request a takeover).',
    }),
};
