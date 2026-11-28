import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_IMAGE_BYTES, MAX_TEXT_FILE_BYTES, type Attachment, type AttachmentContent, type ImageType, type UploadAttachmentRequest } from '@morrowbot/contracts';

/** Where attachment records are kept (the storage feature provides one). */
export interface AttachmentRecords {
  insert(threadId: string, attachment: Attachment, createdAt: string): void;
  get(id: string): Attachment | undefined;
  ids(): Set<string>;
  deleteUnsentBefore(at: string): string[];
}

export interface AttachmentServiceOptions {
  /** The data folder's `attachments/`: each file is named by its id and is readable only by this user. */
  readonly dir: string;
  readonly records: AttachmentRecords;
  readonly threadExists: (threadId: string) => boolean;
  readonly newId: () => string;
  /** Stamps uploads. */
  readonly now: () => string;
  /** The wall clock the unsent-upload cutoff is measured on. */
  readonly clock?: () => number;
}

export type UploadResult =
  | { readonly kind: 'saved'; readonly attachment: Attachment }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface AttachmentService {
  /** Checks and keeps a file for the thread's next send. */
  upload(threadId: string, request: UploadAttachmentRequest): Promise<UploadResult>;
  /** A kept file's content, or undefined for an unknown id. */
  content(id: string): Promise<AttachmentContent | undefined>;
  /** The content of an attachment a message carries; throws when its file is gone. */
  read(attachment: Attachment): Promise<AttachmentContent>;
  /** Removes uploads never sent within a day, and files whose chat was deleted. */
  sweep(): Promise<void>;
}

/** Uploads left unsent for this long are removed. */
const UNSENT_MS = 24 * 60 * 60 * 1000;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The first bytes each image type starts with; `null` matches any byte. */
const SIGNATURES: Readonly<Record<ImageType, readonly (readonly (number | null)[])[]>> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
};

/** Whether `bytes` start like an image of `type`, so a renamed file of another kind is refused. */
export function looksLike(type: ImageType, bytes: Buffer): boolean {
  return SIGNATURES[type].some((signature) => bytes.length >= signature.length && signature.every((byte, index) => byte === null || bytes[index] === byte));
}

type Checked = { readonly kind: 'ok'; readonly bytes: Buffer; readonly attachment: Attachment } | { readonly kind: 'invalid'; readonly reason: string };

function check(id: string, request: UploadAttachmentRequest): Checked {
  switch (request.kind) {
    case 'image': {
      const bytes = Buffer.from(request.data, 'base64');
      if (bytes.length === 0) return { kind: 'invalid', reason: 'The image is empty.' };
      if (bytes.length > MAX_IMAGE_BYTES) return { kind: 'invalid', reason: 'Images can be up to 8 MB.' };
      if (!looksLike(request.mimeType, bytes)) return { kind: 'invalid', reason: 'The file is not the image type it says it is.' };
      return { kind: 'ok', bytes, attachment: { kind: 'image', id, name: request.name, mimeType: request.mimeType, size: bytes.length } };
    }
    case 'text': {
      const bytes = Buffer.from(request.text, 'utf8');
      if (bytes.length > MAX_TEXT_FILE_BYTES) return { kind: 'invalid', reason: 'Text files can be up to 256 KB.' };
      if (request.text.includes('\0')) return { kind: 'invalid', reason: 'The file is not text.' };
      return { kind: 'ok', bytes, attachment: { kind: 'text', id, name: request.name, size: bytes.length } };
    }
  }
}

export function createAttachmentService(options: AttachmentServiceOptions): AttachmentService {
  const { dir, records } = options;
  /** Files written whose row is not saved yet, which a sweep must leave alone. */
  const writing = new Set<string>();
  const fileOf = (id: string): string => {
    if (!SAFE_ID.test(id)) throw new Error('Unsafe attachment id');
    return path.join(dir, id);
  };

  async function read(attachment: Attachment): Promise<AttachmentContent> {
    const bytes = await readFile(fileOf(attachment.id));
    switch (attachment.kind) {
      case 'image':
        return { kind: 'image', mimeType: attachment.mimeType, data: bytes.toString('base64') };
      case 'text':
        return { kind: 'text', text: bytes.toString('utf8') };
    }
  }

  return {
    upload: async (threadId, request) => {
      if (!options.threadExists(threadId)) return { kind: 'not-found' };
      const checked = check(options.newId(), request);
      if (checked.kind === 'invalid') return checked;
      const { id } = checked.attachment;
      writing.add(id);
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(fileOf(id), checked.bytes, { flag: 'wx', mode: 0o600 });
        if (!options.threadExists(threadId)) {
          await unlink(fileOf(id));
          return { kind: 'not-found' };
        }
        records.insert(threadId, checked.attachment, options.now());
        return { kind: 'saved', attachment: checked.attachment };
      } catch (error) {
        await unlink(fileOf(id)).catch(() => undefined);
        throw error;
      } finally {
        writing.delete(id);
      }
    },
    content: async (id) => {
      const attachment = records.get(id);
      return attachment === undefined ? undefined : read(attachment);
    },
    read,
    sweep: async () => {
      records.deleteUnsentBefore(new Date((options.clock ?? Date.now)() - UNSENT_MS).toISOString());
      const kept = records.ids();
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
      await Promise.all(names.filter((name) => SAFE_ID.test(name) && !kept.has(name) && !writing.has(name)).map((name) => unlink(path.join(dir, name))));
    },
  };
}
