import { MAX_IMAGE_BYTES, MAX_TEXT_FILE_BYTES } from '@morrowbot/contracts';
import type { PickedFile } from './composer-attachments.ts';

/** Photos are sent as JPEG, no longer than this on their long edge: vision models scale larger ones down anyway. */
export const IMAGE_LONG_EDGE = 2048;
export const IMAGE_QUALITY = 0.85;

const TEXT_EXTENSIONS = /\.(md|markdown|txt|json|csv|tsv|log|ya?ml|toml|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cpp|sh|zsh|sql|ini)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|heic|heif|gif|tiff?|bmp)$/i;
const TEXT_TOO_LARGE = 'Text files can be up to 256 KB.';
const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/x-yaml', 'application/toml']);

/** A file name the host takes: no path separators, at most 255 characters, `fallback` when blank. */
export function cleanName(raw: string | null | undefined, fallback: string): string {
  const name = (raw ?? '').replace(/[/\\\0]/g, '_').trim();
  return (name === '' ? fallback : name).slice(0, 255);
}

/** The name a photo goes up as once it is re-encoded as JPEG. */
export function jpegName(raw: string | null | undefined): string {
  const name = cleanName(raw, 'photo');
  const stem = name.replace(/\.[^.]+$/, '');
  return `${stem === '' ? 'photo' : stem.slice(0, 251)}.jpg`;
}

/** How a picked file is read: re-encoded as a photo, read as UTF-8 text, or refused. */
export type FileRoute = { readonly kind: 'image' } | { readonly kind: 'text' } | { readonly kind: 'refused'; readonly reason: string };

export function routeOf(file: { readonly name: string; readonly mimeType: string; readonly size: number | null }): FileRoute {
  const type = file.mimeType.toLowerCase();
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)) return { kind: 'image' };
  if (type.startsWith('text/') || TEXT_TYPES.has(type) || TEXT_EXTENSIONS.test(file.name)) {
    return file.size !== null && file.size > MAX_TEXT_FILE_BYTES ? { kind: 'refused', reason: TEXT_TOO_LARGE } : { kind: 'text' };
  }
  return { kind: 'refused', reason: 'Only photos and text files can be attached.' };
}

/** A text file's content as the host takes it: at most 256 KB of UTF-8, and not binary. */
export function textUpload(name: string, text: string): PickedFile {
  if (new TextEncoder().encode(text).length > MAX_TEXT_FILE_BYTES) return { kind: 'refused', name, reason: TEXT_TOO_LARGE };
  if (text.includes('\0')) return { kind: 'refused', name, reason: 'This file is not text.' };
  return { kind: 'upload', request: { kind: 'text', name, text }, preview: null };
}

/** A re-encoded JPEG as the host takes it, at most 8 MB. */
export function jpegUpload(name: string, base64: string, preview: string): PickedFile {
  if (Math.floor((base64.length * 3) / 4) > MAX_IMAGE_BYTES) return { kind: 'refused', name, reason: 'Images can be up to 8 MB.' };
  return { kind: 'upload', request: { kind: 'image', name, mimeType: 'image/jpeg', data: base64 }, preview };
}
