import { expect, it } from 'vitest';
import { base32Bytes, totp } from './totp.ts';

/** RFC 6238 Appendix B, SHA-1 rows: the 20-byte ASCII seed "12345678901234567890", 30-second steps, 8 digits. */
const RFC_6238_SHA1 = [
  { time: 59, code: '94287082' },
  { time: 1111111109, code: '07081804' },
  { time: 1111111111, code: '14050471' },
  { time: 1234567890, code: '89005924' },
  { time: 2000000000, code: '69279037' },
  { time: 20000000000, code: '65353130' },
];

it('matches the RFC 6238 SHA-1 test vectors, and gives their last six digits as a 6-digit code', () => {
  const seed = base32Bytes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  expect(seed.toString('ascii')).toBe('12345678901234567890');
  expect(RFC_6238_SHA1.map(({ time }) => [totp(seed, time * 1000, 8), totp(seed, time * 1000)])).toEqual(
    RFC_6238_SHA1.map(({ code }) => [code, code.slice(2)]),
  );
});
