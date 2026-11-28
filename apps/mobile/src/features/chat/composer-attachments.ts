import { MAX_ATTACHMENTS, type Attachment, type UploadAttachmentRequest } from '@morrowbot/contracts';
import type { ChatResult } from '../../lib/chat-host.ts';

/** A file read on this phone, ready to upload; `refused` when it can't be attached. `preview` is a local image URI. */
export type PickedFile =
  | { readonly kind: 'upload'; readonly request: UploadAttachmentRequest; readonly preview: string | null }
  | { readonly kind: 'refused'; readonly name: string; readonly reason: string };

/** One tile in the strip above the message box. */
export type ComposerAttachment =
  | { readonly kind: 'uploading'; readonly key: number; readonly name: string; readonly preview: string | null }
  | { readonly kind: 'ready'; readonly key: number; readonly attachment: Attachment; readonly preview: string | null }
  /** The upload did not go through; Retry sends `request` again. */
  | { readonly kind: 'failed'; readonly key: number; readonly reason: string; readonly request: UploadAttachmentRequest; readonly preview: string | null }
  /** Never uploaded: too large, not a type the host takes, or past the limit. */
  | { readonly kind: 'refused'; readonly key: number; readonly name: string; readonly reason: string };

export interface AttachmentTray {
  /** Uploads each file to the thread; refused files, and files past the limit, show as refused tiles. */
  add(files: readonly PickedFile[]): void;
  retry(key: number): void;
  /** Takes the tile away; an upload still running is forgotten (the host drops unsent uploads). */
  remove(key: number): void;
  /** Drops the tiles of the files a send carried. */
  sent(ids: readonly string[]): void;
}

const LIMIT_REASON = `A message can carry ${String(MAX_ATTACHMENTS)} files.`;

const holdsPlace = (item: ComposerAttachment): boolean => item.kind !== 'refused';

/** How many more files the `+` can add. */
export function roomLeft(items: readonly ComposerAttachment[]): number {
  return MAX_ATTACHMENTS - items.filter(holdsPlace).length;
}

/** The ids a send carries: every uploaded file, or null while one is still uploading. */
export function sendableIds(items: readonly ComposerAttachment[]): readonly string[] | null {
  if (items.some((item) => item.kind === 'uploading')) return null;
  return items.flatMap((item) => (item.kind === 'ready' ? [item.attachment.id] : []));
}

export function attachmentTray(
  upload: (request: UploadAttachmentRequest) => Promise<ChatResult<Attachment>>,
  items: { readonly get: () => readonly ComposerAttachment[]; readonly set: (next: readonly ComposerAttachment[]) => void },
): AttachmentTray {
  let next = 0;
  const replace = (key: number, item: ComposerAttachment | null): void => {
    items.set(items.get().flatMap((each) => (each.key !== key ? [each] : item === null ? [] : [item])));
  };
  const has = (key: number, kind: ComposerAttachment['kind']): boolean => items.get().some((item) => item.key === key && item.kind === kind);

  async function start(key: number, request: UploadAttachmentRequest, preview: string | null): Promise<void> {
    const result = await upload(request);
    if (!has(key, 'uploading')) return;
    replace(
      key,
      result.kind === 'ok'
        ? { kind: 'ready', key, attachment: result.value, preview }
        : { kind: 'failed', key, reason: result.error.message, request, preview },
    );
  }

  return {
    add: (files) => {
      for (const file of files) {
        const key = ++next;
        const current = items.get();
        if (file.kind === 'refused') {
          items.set([...current, { kind: 'refused', key, name: file.name, reason: file.reason }]);
        } else if (roomLeft(current) <= 0) {
          items.set([...current, { kind: 'refused', key, name: file.request.name, reason: LIMIT_REASON }]);
        } else {
          items.set([...current, { kind: 'uploading', key, name: file.request.name, preview: file.preview }]);
          void start(key, file.request, file.preview);
        }
      }
    },
    retry: (key) => {
      const item = items.get().find((each) => each.key === key);
      if (item?.kind !== 'failed') return;
      replace(key, { kind: 'uploading', key, name: item.request.name, preview: item.preview });
      void start(key, item.request, item.preview);
    },
    remove: (key) => {
      replace(key, null);
    },
    sent: (ids) => {
      items.set(items.get().filter((item) => item.kind !== 'ready' || !ids.includes(item.attachment.id)));
    },
  };
}
