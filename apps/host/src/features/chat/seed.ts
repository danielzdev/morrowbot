import { createHash } from 'node:crypto';
import { MAX_SEED_BYTES, type Message } from '@morrowbot/contracts';

export interface Seed {
  readonly text: string | null;
  /** Older messages were dropped to fit the budget. */
  readonly truncated: boolean;
}

/** A new seeded session gets at most the last 20 messages, at most 32 KB. */
export const SEEDED_SESSION_BUDGET = { messages: 20, bytes: 32_768 };

/**
 * Renders history as the plain-text seed a provider reads: role-labelled blocks, oldest first,
 * dropping the oldest messages until it fits. Empty messages are left out. Null when nothing is left.
 */
export function renderSeed(history: readonly Message[], budget: { readonly messages: number; readonly bytes: number }): Seed {
  const blocks = history.filter((message) => message.text !== '').map((message) => `<${message.kind}>\n${message.text}\n</${message.kind}>`);
  let kept = blocks.slice(-budget.messages);
  let truncated = kept.length < blocks.length;
  while (kept.length > 0 && Buffer.byteLength(kept.join('\n')) > budget.bytes) {
    kept = kept.slice(1);
    truncated = true;
  }
  return { text: kept.length === 0 ? null : kept.join('\n'), truncated };
}

/** The stateless budget: 256 KB, or the plugin's smaller `maxSeedBytes`. */
export function statelessBudget(maxSeedBytes: number | undefined): { readonly messages: number; readonly bytes: number } {
  return { messages: Number.POSITIVE_INFINITY, bytes: Math.min(MAX_SEED_BYTES, maxSeedBytes ?? MAX_SEED_BYTES) };
}

/** The hash a session's instructions are compared by: SHA-256 of the AGENTS.md text ('' when missing). */
export function instructionsHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
