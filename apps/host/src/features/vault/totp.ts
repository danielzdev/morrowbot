import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The bytes of an RFC 4648 base32 string (upper case, no padding: the `TwoStepKey` contract's form). */
export function base32Bytes(text: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error('Not a base32 string');
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * The RFC 6238 time-based one-time password for `key` at `unixMs`: HMAC-SHA1 over the count of
 * 30-second steps since the Unix epoch, truncated as in RFC 4226 §5.3 to `digits` digits.
 */
export function totp(key: Buffer, unixMs: number, digits = 6, stepSeconds = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(unixMs / 1000 / stepSeconds)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
