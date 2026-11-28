import { createHash } from 'node:crypto';
import { MAX_SEED_BYTES, type Message, type ToolStep } from '@morrowbot/contracts';

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
 * A reply lists the tools it called (`tools`, by message id), not what they read or wrote.
 */
export function renderSeed(
  history: readonly Message[],
  budget: { readonly messages: number; readonly bytes: number },
  tools: ReadonlyMap<string, readonly ToolStep[]> = new Map(),
): Seed {
  const blocks = history.map((message) => ({ kind: message.kind, body: bodyOf(message, tools.get(message.id) ?? []) })).filter(({ body }) => body !== '').map(({ kind, body }) => `<${kind}>\n${body}\n</${kind}>`);
  let kept = blocks.slice(-budget.messages);
  let truncated = kept.length < blocks.length;
  while (kept.length > 0 && Buffer.byteLength(kept.join('\n')) > budget.bytes) {
    kept = kept.slice(1);
    truncated = true;
  }
  return { text: kept.length === 0 ? null : kept.join('\n'), truncated };
}

/**
 * A message's text, with the names of the files it carried (their content is not resent), and for a reply the
 * tools it called and how each ended.
 */
function bodyOf(message: Message, tools: readonly ToolStep[]): string {
  const attached = message.attachments.length === 0 ? message.text : `${message.text}\n[Attached: ${message.attachments.map(({ name }) => name).join(', ')}]`.trim();
  if (message.kind === 'user' || tools.length === 0) return attached;
  return `[Tools: ${tools.map(({ name, outcome }) => `${name} (${outcome})`).join(', ')}]\n${attached}`.trim();
}

/** The stateless budget: 256 KB, or the plugin's smaller `maxSeedBytes`. */
export function statelessBudget(maxSeedBytes: number | undefined): { readonly messages: number; readonly bytes: number } {
  return { messages: Number.POSITIVE_INFINITY, bytes: Math.min(MAX_SEED_BYTES, maxSeedBytes ?? MAX_SEED_BYTES) };
}

/** The hash a session's instructions are compared by: SHA-256 of the SOUL.md text ('' when missing). */
export function instructionsHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
