import type { ReplyAttachment } from '@morrowbot/contracts';

const KIND_LABEL: Readonly<Record<ReplyAttachment['kind'], string>> = { image: 'Image', video: 'Video', file: 'File' };

function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What a reply attachment's chip says under its name on the phone: "PDF · 1.2 MB", "Image · 640 KB". */
export function chipMeta(attachment: ReplyAttachment): string {
  const label = attachment.mimeType === 'application/pdf' ? 'PDF' : KIND_LABEL[attachment.kind];
  return `${label} · ${size(attachment.size)}`;
}
