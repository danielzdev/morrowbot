/** Which per-turn output cap was exceeded. */
export type OutputLimitKind = 'bytes' | 'events';

/** Host-side cap on one provider turn's accumulated reply bytes and streamed chunk events. */
export interface TurnOutputBudget {
  readonly maxBytes: number;
  readonly maxEvents: number;
}

/** 4 MiB of UTF-8 reply text and 100,000 streamed chunks per turn. */
export const DEFAULT_TURN_OUTPUT_BUDGET: TurnOutputBudget = {
  maxBytes: 4 * 1024 * 1024,
  maxEvents: 100_000,
};

/**
 * Returns the longest prefix of `text` whose UTF-8 encoding fits in `maxBytes` bytes
 * without splitting a UTF-16 surrogate pair.
 */
export function sliceUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text === '') return '';
  if (text.length <= maxBytes && Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let used = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const step = codePoint > 0xffff ? 2 : 1;
    const bytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (used + bytes > maxBytes) break;
    used += bytes;
    index += step;
  }
  return text.slice(0, index);
}
