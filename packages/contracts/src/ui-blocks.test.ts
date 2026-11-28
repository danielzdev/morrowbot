import { expect, it } from 'vitest';
import { UiBlocks } from './ui-blocks.ts';

const SAMPLES = {
  plain: 'Pick a day',
  tabAndNewline: 'Monday\tor\nTuesday',
  familyEmoji: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
  persianJoiner: '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645',
  rightToLeftOverride: 'invoice\u202Etxt.exe',
  arabicLetterMark: 'a\u061Cb',
  c1Control: 'a\u0085b',
  delete: 'a\u007Fb',
  zeroWidthSpace: 'a\u200Bb',
  lineSeparator: 'a\u2028b',
  byteOrderMark: 'h\uFEFFi',
  tagCharacter: 'hi\u{E0041}',
};

it('keeps text that reads as written and refuses characters that hide or reorder it', () => {
  const verdicts = Object.fromEntries(
    Object.entries(SAMPLES).map(([name, text]) => [name, UiBlocks.safeParse({ fallbackText: 'Card', blocks: [{ kind: 'text', text }] }).success ? 'kept' : 'refused']),
  );
  expect(verdicts).toMatchInlineSnapshot(`
    {
      "arabicLetterMark": "refused",
      "byteOrderMark": "refused",
      "c1Control": "refused",
      "delete": "refused",
      "familyEmoji": "kept",
      "lineSeparator": "refused",
      "persianJoiner": "kept",
      "plain": "kept",
      "rightToLeftOverride": "refused",
      "tabAndNewline": "kept",
      "tagCharacter": "refused",
      "zeroWidthSpace": "refused",
    }
  `);
});
