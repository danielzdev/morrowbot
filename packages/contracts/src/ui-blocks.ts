import { z } from 'zod';

/** Text-direction marks, embeddings, overrides and isolates; invisible spaces and line breaks; the byte-order mark. */
const HIDDEN = new Set([
  0x061c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

/**
 * Whether `text` holds a control character other than tab and newline, a text-direction or invisible character, or
 * a tag character: text that could reorder or hide what the user reads (a right-to-left override can make "exe.txt"
 * read as "txt.exe"). Zero-width joiners stay, since emoji sequences and some scripts need them.
 */
function hidesText(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const control = (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    if (control || HIDDEN.has(code) || (code >= 0xe0000 && code <= 0xe007f)) return true;
  }
  return false;
}

/** Plain text an agent wrote for a card: shown as text, never as markup, with nothing that hides or reorders it. */
function cardText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !hidesText(text), { error: 'Remove control, invisible and text-direction characters' });
}

export const UiTone = z.enum(['neutral', 'info', 'success', 'warning']);
export type UiTone = z.infer<typeof UiTone>;

export const UiChoiceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'Use up to 32 lowercase letters, digits and dashes');

export const UiChoice = z.strictObject({ id: UiChoiceId, label: cardText(60) });
export type UiChoice = z.infer<typeof UiChoice>;

/**
 * One piece of an agent's card. The list is closed: there is no markup, link, image, script or style, so a card
 * can show only text the host draws with its own components, and a click can only answer the card.
 */
export const UiBlock = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('header'), text: cardText(120) }),
  z.strictObject({ kind: z.literal('text'), text: cardText(2_000) }),
  z.strictObject({ kind: z.literal('kv'), items: z.array(z.strictObject({ label: cardText(60), value: cardText(200) })).min(1).max(12) }),
  z.strictObject({ kind: z.literal('list'), style: z.enum(['bullet', 'number']), items: z.array(cardText(300)).min(1).max(20) }),
  z.strictObject({ kind: z.literal('badges'), items: z.array(z.strictObject({ text: cardText(40), tone: UiTone })).min(1).max(8) }),
  z.strictObject({ kind: z.literal('divider') }),
  /** Buttons for the user's answer: a click sends the chosen label to the agent as the user's message, once. */
  z.strictObject({ kind: z.literal('choices'), options: z.array(UiChoice).min(1).max(6) }),
]);
export type UiBlock = z.infer<typeof UiBlock>;

/**
 * An agent's custom card: `fallbackText` says the same in plain words, for screen readers and for clients that
 * cannot draw a block. At most one `choices` block, each option id once.
 */
export const UiBlocks = z
  .strictObject({ fallbackText: cardText(2_000), blocks: z.array(UiBlock).min(1).max(24) })
  .refine(({ blocks }) => blocks.filter(({ kind }) => kind === 'choices').length <= 1, { error: 'Use at most one choices block' })
  .refine(
    ({ blocks }) =>
      blocks.every((block) => block.kind !== 'choices' || new Set(block.options.map(({ id }) => id)).size === block.options.length),
    { error: 'Give each choice its own id' },
  );
export type UiBlocks = z.infer<typeof UiBlocks>;

/** The card's choice options, if it asks for an answer. */
export function choicesOf(blocks: UiBlocks): readonly UiChoice[] {
  for (const block of blocks.blocks) if (block.kind === 'choices') return block.options;
  return [];
}
