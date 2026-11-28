import { MAX_ATTACHMENTS, type Attachment, type UploadAttachmentRequest } from '@morrowbot/contracts';
import type { Api } from '../../shared/api.ts';
import { Store } from '../../shared/store.ts';

/** A file the user picked, pasted or dropped, read in the window; `refused` when it can't be attached. */
export type PickedFile =
  | { readonly kind: 'upload'; readonly request: UploadAttachmentRequest; readonly preview: string | null }
  | { readonly kind: 'refused'; readonly name: string; readonly reason: string };

/** One chip above the message box. `preview` is the image's data URL, or null for a text file. */
export type ComposerAttachment =
  | { readonly kind: 'uploading'; readonly key: number; readonly name: string; readonly preview: string | null }
  | { readonly kind: 'ready'; readonly key: number; readonly attachment: Attachment; readonly preview: string | null }
  | { readonly kind: 'failed'; readonly key: number; readonly name: string; readonly reason: string };

export interface ComposerAttachments {
  readonly items: Store<readonly ComposerAttachment[]>;
  /** Uploads each file to the chat; one past the limit, or refused, shows as a failed chip. */
  add(files: readonly PickedFile[]): void;
  remove(key: number): void;
  /** The ids a send carries: every uploaded file, or null while one is still uploading. */
  readyIds(): readonly string[] | null;
  /** Drops the chips of files a send just carried. */
  sent(ids: readonly string[]): void;
}

export function composerAttachments(api: Pick<Api, 'uploadAttachment'>, threadId: string): ComposerAttachments {
  const items = new Store<readonly ComposerAttachment[]>([]);
  let next = 0;
  const replace = (key: number, item: ComposerAttachment | null): void => {
    items.update((current) => current.flatMap((each) => (each.key !== key ? [each] : item === null ? [] : [item])));
  };
  async function upload(key: number, file: Extract<PickedFile, { kind: 'upload' }>): Promise<void> {
    const result = await api.uploadAttachment(threadId, file.request);
    if (!items.get().some((item) => item.key === key)) return;
    replace(
      key,
      result.kind === 'ok'
        ? { kind: 'ready', key, attachment: result.value, preview: file.preview }
        : { kind: 'failed', key, name: file.request.name, reason: result.error.message },
    );
  }
  return {
    items,
    add: (files) => {
      for (const file of files) {
        const key = ++next;
        const taken = items.get().filter((item) => item.kind !== 'failed').length;
        if (file.kind === 'refused') {
          items.update((current) => [...current, { kind: 'failed', key, name: file.name, reason: file.reason }]);
        } else if (taken >= MAX_ATTACHMENTS) {
          items.update((current) => [...current, { kind: 'failed', key, name: file.request.name, reason: `A message can carry ${String(MAX_ATTACHMENTS)} files.` }]);
        } else {
          items.update((current) => [...current, { kind: 'uploading', key, name: file.request.name, preview: file.preview }]);
          void upload(key, file);
        }
      }
    },
    remove: (key) => {
      replace(key, null);
    },
    readyIds: () => {
      const current = items.get();
      if (current.some((item) => item.kind === 'uploading')) return null;
      return current.flatMap((item) => (item.kind === 'ready' ? [item.attachment.id] : []));
    },
    sent: (ids) => {
      items.update((current) => current.filter((item) => item.kind !== 'ready' || !ids.includes(item.attachment.id)));
    },
  };
}

/** Loads sent images for the chat's bubbles once each, as data URLs. */
export function attachmentImages(api: Pick<Api, 'attachmentContent'>): (id: string) => Promise<string | null> {
  const loaded = new Map<string, Promise<string | null>>();
  return (id) => {
    let image = loaded.get(id);
    if (image === undefined) {
      image = api.attachmentContent(id).then((result) =>
        result.kind === 'ok' && result.value.kind === 'image' ? `data:${result.value.mimeType};base64,${result.value.data}` : null,
      );
      loaded.set(id, image);
      void image.then((url) => {
        if (url === null) loaded.delete(id);
      });
    }
    return image;
  };
}
