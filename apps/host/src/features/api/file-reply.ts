import { createReadStream } from 'node:fs';
import type { ServerResponse } from 'node:http';

/** A kept file's bytes, whole or one byte range of them. */
export interface FileReply {
  readonly kind: 'file';
  readonly status: 200 | 206;
  readonly file: string;
  readonly start: number;
  /** Inclusive; `start - 1` for an empty file. */
  readonly end: number;
  readonly headers: Readonly<Record<string, string>>;
}

export type ByteRange = { readonly kind: 'whole' } | { readonly kind: 'part'; readonly start: number; readonly end: number } | { readonly kind: 'unsatisfiable' };

/** One `bytes=` range of a `size`-byte file (multiple ranges are served whole, as RFC 9110 allows). */
export function byteRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return { kind: 'whole' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return { kind: 'whole' };
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return { kind: 'whole' };
  if (from === '') {
    const suffix = Number(to);
    return suffix === 0 || size === 0 ? { kind: 'unsatisfiable' } : { kind: 'part', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start >= size || end < start ? { kind: 'unsatisfiable' } : { kind: 'part', start, end };
}

/** Streams the reply's bytes; a read error (the file vanished) cuts the response off rather than crashing. */
export function sendFile(response: ServerResponse, reply: FileReply): void {
  const length = reply.end - reply.start + 1;
  response.writeHead(reply.status, { ...reply.headers, 'content-length': String(length) });
  if (length === 0) {
    response.end();
    return;
  }
  const stream = createReadStream(reply.file, { start: reply.start, end: reply.end });
  stream.on('error', () => {
    response.destroy();
  });
  stream.pipe(response);
}
