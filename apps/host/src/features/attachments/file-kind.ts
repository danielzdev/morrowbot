import path from 'node:path';
import type { ReplyAttachment, ReplyFileType } from '@morrowbot/contracts';

/** How many leading bytes `kindOf` needs to see. */
export const SNIFF_BYTES = 64;

/** A reply attachment's `kind` and `mimeType`, kept paired. */
type Kind = { [K in ReplyAttachment['kind']]: Pick<Extract<ReplyAttachment, { kind: K }>, 'kind' | 'mimeType'> }[ReplyAttachment['kind']];

const startsWith = (bytes: Buffer, signature: readonly (number | null)[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, index) => byte === null || bytes[at + index] === byte);

const ascii = (text: string): number[] => [...Buffer.from(text, 'latin1')];

/** File types by name only, for files whose bytes carry no signature. Only types that render inertly are named. */
const BY_EXTENSION: Readonly<Record<string, ReplyFileType>> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

/**
 * What a reply shows a file as, from its first bytes: images and videos by their signature, PDFs and ZIPs too,
 * plain-text types by name. Anything else is `application/octet-stream`, so a renamed file is never shown as
 * what its name claims.
 */
export function kindOf(name: string, head: Buffer): Kind {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mimeType: 'image/png' };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: 'image', mimeType: 'image/jpeg' };
  if (startsWith(head, [...ascii('RIFF'), null, null, null, null, ...ascii('WEBP')])) return { kind: 'image', mimeType: 'image/webp' };
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return { kind: 'image', mimeType: 'image/gif' };
  if (startsWith(head, ascii('ftyp'), 4) && isMp4Brand(head.subarray(8, 12).toString('latin1'))) return { kind: 'video', mimeType: 'video/mp4' };
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) && head.includes(Buffer.from('webm', 'latin1'))) return { kind: 'video', mimeType: 'video/webm' };
  if (startsWith(head, ascii('%PDF-'))) return { kind: 'file', mimeType: 'application/pdf' };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return { kind: 'file', mimeType: 'application/zip' };
  const byName = BY_EXTENSION[path.extname(name).toLowerCase()];
  return { kind: 'file', mimeType: byName !== undefined && !head.includes(0) ? byName : 'application/octet-stream' };
}

/** MP4 brands browsers play; QuickTime (`qt  `) is left as a plain file. */
function isMp4Brand(brand: string): boolean {
  return /^(isom|iso[2-9]|mp41|mp42|avc1|dash|M4V |MSNV)$/.test(brand);
}
