import { ImageType, MAX_IMAGE_BYTES, MAX_TEXT_FILE_BYTES } from '@morrowbot/contracts';
import type { PickedFile } from './composer-attachments.ts';

/** What the file picker offers: the image types vision providers take, and common text files. */
export const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'text/*', '.md', '.txt', '.json', '.csv', '.log', '.yaml', '.yml', '.toml', '.xml', '.ts', '.tsx', '.js', '.py', '.sh'].join(',');

const TEXT_EXTENSIONS = /\.(md|markdown|txt|json|csv|tsv|log|ya?ml|toml|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cpp|sh|zsh|sql|ini|env\.example)$/i;

const isImage = (type: string): type is ImageType => ImageType.safeParse(type).success;

function isText(file: File): boolean {
  return file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/xml' || TEXT_EXTENSIONS.test(file.name);
}

const nameOf = (file: File): string => (file.name.trim() === '' ? 'pasted file' : file.name.replace(/[/\\\0]/g, '_').slice(0, 255));

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The file could not be read.'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('The file could not be read.'));
    };
    reader.readAsDataURL(file);
  });
}

/** Reads one picked, pasted or dropped file for upload, or says why it can't be attached. */
export async function readFile(file: File): Promise<PickedFile> {
  const name = nameOf(file);
  const refused = (reason: string): PickedFile => ({ kind: 'refused', name, reason });
  try {
    if (isImage(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) return refused('Images can be up to 8 MB.');
      const url = await dataUrl(file);
      return { kind: 'upload', request: { kind: 'image', name, mimeType: file.type, data: url.slice(url.indexOf(',') + 1) }, preview: url };
    }
    if (isText(file)) {
      if (file.size > MAX_TEXT_FILE_BYTES) return refused('Text files can be up to 256 KB.');
      return { kind: 'upload', request: { kind: 'text', name, text: await file.text() }, preview: null };
    }
  } catch {
    return refused('The file could not be read.');
  }
  return refused('Only PNG, JPEG and WebP images and text files can be attached.');
}

export function readFiles(files: Iterable<File>): Promise<PickedFile[]> {
  return Promise.all([...files].map(readFile));
}
