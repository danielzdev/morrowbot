import { MAX_ATTACHMENTS, type Attachment, type UploadAttachmentRequest } from '@morrowbot/contracts';
import type { ChatResult } from '../../lib/chat-host.ts';

/** A file read on this phone, ready to upload; `refused` when it can't be attached. `preview` is a local image URI. */
export type PickedFile =
  | { readonly kind: 'upload'; readonly request: UploadAttachmentRequest; readonly preview: string | null }
  | { readonly kind: 'refused'; readonly name: string; readonly reason: string };

/** A file the user just picked, not read yet. `read` re-encodes or reads it. */
export interface Pick {
  readonly name: string;
  readonly preview: string | null;
  readonly read: () => Promise<PickedFile>;
}

/** One tile in the strip above the message box. */
export type ComposerAttachment =
  /** Picked; waiting its turn to be read, one file at a time. */
  | { readonly kind: 'preparing'; readonly key: number; readonly name: string; readonly preview: string | null }
  | { readonly kind: 'uploading'; readonly key: number; readonly name: string; readonly preview: string | null }
  | { readonly kind: 'ready'; readonly key: number; readonly attachment: Attachment; readonly preview: string | null }
  /** The upload did not go through; Retry sends `request` again. */
  | { readonly kind: 'failed'; readonly key: number; readonly reason: string; readonly request: UploadAttachmentRequest; readonly preview: string | null }
  /** Never uploaded: too large, not a type the host takes, or past the limit. */
  | { readonly kind: 'refused'; readonly key: number; readonly name: string; readonly reason: string };

export interface AttachmentTray {
  /** Shows a tile for each pick at once, then reads and uploads them; picks past the limit show as refused. */
  add(picks: readonly Pick[]): void;
  retry(key: number): void;
  /** Takes the tile away; a read or upload still running is forgotten (the host drops unsent uploads). */
  remove(key: number): void;
  /** Drops the tiles of the files a send carried. */
  sent(ids: readonly string[]): void;
}

const LIMIT_REASON = `A message can carry ${String(MAX_ATTACHMENTS)} files.`;

/** How many more files the `+` can add. */
export function roomLeft(items: readonly ComposerAttachment[]): number {
  return MAX_ATTACHMENTS - items.filter((item) => item.kind !== 'refused').length;
}

/** The ids a send carries: every tile's, once every tile is uploaded. Null while one is not, so Send never leaves a shown file behind. */
export function sendableIds(items: readonly ComposerAttachment[]): readonly string[] | null {
  const ids = items.flatMap((item) => (item.kind === 'ready' ? [item.attachment.id] : []));
  return ids.length === items.length ? ids : null;
}

export function attachmentTray(
  upload: (request: UploadAttachmentRequest) => Promise<ChatResult<Attachment>>,
  items: { readonly get: () => readonly ComposerAttachment[]; readonly set: (next: readonly ComposerAttachment[]) => void },
): AttachmentTray {
  let next = 0;
  let reading: Promise<void> = Promise.resolve();
  const replace = (key: number, item: ComposerAttachment | null): void => {
    items.set(items.get().flatMap((each) => (each.key !== key ? [each] : item === null ? [] : [item])));
  };
  const has = (key: number, kind: ComposerAttachment['kind']): boolean => items.get().some((item) => item.key === key && item.kind === kind);

  async function start(key: number, request: UploadAttachmentRequest, preview: string | null): Promise<void> {
    replace(key, { kind: 'uploading', key, name: request.name, preview });
    const result = await upload(request);
    if (!has(key, 'uploading')) return;
    replace(
      key,
      result.kind === 'ok'
        ? { kind: 'ready', key, attachment: result.value, preview }
        : { kind: 'failed', key, reason: result.error.message, request, preview },
    );
  }

  async function prepare(key: number, pick: Pick): Promise<void> {
    if (!has(key, 'preparing')) return;
    const file = await pick.read().catch((): PickedFile => ({ kind: 'refused', name: pick.name, reason: 'The file could not be read.' }));
    if (!has(key, 'preparing')) return;
    if (file.kind === 'refused') replace(key, { kind: 'refused', key, name: file.name, reason: file.reason });
    else void start(key, file.request, file.preview);
  }

  return {
    add: (picks) => {
      for (const pick of picks) {
        const key = ++next;
        if (roomLeft(items.get()) <= 0) {
          items.set([...items.get(), { kind: 'refused', key, name: pick.name, reason: LIMIT_REASON }]);
          continue;
        }
        items.set([...items.get(), { kind: 'preparing', key, name: pick.name, preview: pick.preview }]);
        reading = reading.then(() => prepare(key, pick));
      }
    },
    retry: (key) => {
      const item = items.get().find((each) => each.key === key);
      if (item?.kind === 'failed') void start(key, item.request, item.preview);
    },
    remove: (key) => {
      replace(key, null);
    },
    sent: (ids) => {
      items.set(items.get().filter((item) => item.kind !== 'ready' || !ids.includes(item.attachment.id)));
    },
  };
}
