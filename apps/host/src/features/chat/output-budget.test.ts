import { expect, it } from 'vitest';
import { sliceUtf8 } from './output-budget.ts';

it('slices strings to a UTF-8 byte budget without splitting multibyte characters or surrogate pairs', () => {
  expect({
    empty: sliceUtf8('', 10),
    zero: sliceUtf8('hello', 0),
    negative: sliceUtf8('hello', -5),
    exact: sliceUtf8('hello', 5),
    asciiTrim: sliceUtf8('hello world', 5),
    twoByteBefore: sliceUtf8('aé', 2),
    twoByteExact: sliceUtf8('aé', 3),
    emojiBefore: sliceUtf8('a😀b', 4),
    emojiExact: sliceUtf8('a😀b', 5),
    emojiOnly: sliceUtf8('😀', 3),
    threeByte: sliceUtf8('日本語', 7),
  }).toMatchInlineSnapshot(`
    {
      "asciiTrim": "hello",
      "emojiBefore": "a",
      "emojiExact": "a😀",
      "emojiOnly": "",
      "empty": "",
      "exact": "hello",
      "negative": "",
      "threeByte": "日本",
      "twoByteBefore": "a",
      "twoByteExact": "aé",
      "zero": "",
    }
  `);
  expect(Buffer.byteLength(sliceUtf8('a😀b', 4), 'utf8')).toBeLessThanOrEqual(4);
  expect(Buffer.byteLength(sliceUtf8('日本語', 7), 'utf8')).toBeLessThanOrEqual(7);
});
