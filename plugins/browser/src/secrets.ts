import { SecretField, type SecretFillRequest, type SecretResolution } from '@morrowbot/contracts';
import { z } from '@morrowbot/plugin-sdk';

/** What the agent may say about a secret: which vault login and which part of it. Never the value. */
export const SecretRequest = z.strictObject({
  vaultId: z.string().min(1).max(128).describe('The vault login, by the id list_vault_items gives'),
  field: SecretField,
});
export type SecretRequest = z.infer<typeof SecretRequest>;

/**
 * Resolves a secret for one page origin, outside the model: the host checks the login's site against `origin`.
 * The value goes straight to the browser and is never shown to the agent.
 */
export type SecretSource = (request: SecretFillRequest) => Promise<SecretResolution>;
