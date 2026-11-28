import { opensInViewer, type ReplyAttachment } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import type { FileActionResult } from '../../bridge.ts';
import { formatBytes } from '../../shared/format.ts';
import { Icon } from '../../shared/ui/Icon.tsx';

/** How the chat loads and hands off the files an agent attached to its reply. */
export interface ReplyFiles {
  /** The URL the window loads a reply attachment's bytes from. */
  url(id: string): string;
  act(action: 'open' | 'save', attachment: ReplyAttachment): Promise<FileActionResult>;
}

const TYPE_LABEL: Readonly<Record<ReplyAttachment['mimeType'], string>> = {
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/webp': 'WebP image',
  'image/gif': 'GIF image',
  'video/mp4': 'MP4 video',
  'video/webm': 'WebM video',
  'application/pdf': 'PDF',
  'application/zip': 'ZIP archive',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'application/octet-stream': 'File',
};

/** "PDF · 1.2 MB": what a file card says under its name. */
export function fileMeta(attachment: ReplyAttachment): string {
  return `${TYPE_LABEL[attachment.mimeType]} · ${formatBytes(attachment.size)}`;
}

function useAction(files: ReplyFiles, attachment: ReplyAttachment): { readonly problem: string | null; readonly busy: boolean; readonly run: (action: 'open' | 'save') => void } {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (action: 'open' | 'save'): void => {
    setBusy(true);
    setProblem(null);
    void files.act(action, attachment).then(
      (result) => {
        setBusy(false);
        setProblem(result.kind === 'failed' ? result.reason : null);
      },
      () => {
        setBusy(false);
        setProblem("MorrowBot couldn't get this file.");
      },
    );
  };
  return { problem, busy, run };
}

function FileCard(props: { readonly attachment: ReplyAttachment; readonly files: ReplyFiles }) {
  const { attachment } = props;
  const { problem, busy, run } = useAction(props.files, attachment);
  return (
    <div class="reply-file" data-kind={attachment.mimeType === 'application/pdf' ? 'pdf' : attachment.kind}>
      <span class="reply-file-icon" aria-hidden="true">
        {attachment.mimeType === 'application/pdf' ? <span class="reply-file-badge">PDF</span> : <Icon name="file" size={16} />}
      </span>
      <span class="reply-file-text">
        <span class="reply-file-name" title={attachment.name}>{attachment.name}</span>
        <span class="reply-file-meta">{problem ?? fileMeta(attachment)}</span>
      </span>
      <span class="reply-file-actions">
        {opensInViewer(attachment) && (
          <button class="secondary" disabled={busy} aria-label={`Open ${attachment.name}`} onClick={() => { run('open'); }}>Open</button>
        )}
        <button class="ghost" disabled={busy} aria-label={`Save ${attachment.name}`} onClick={() => { run('save'); }}>Save…</button>
      </span>
    </div>
  );
}

function Media(props: { readonly attachment: Extract<ReplyAttachment, { kind: 'image' | 'video' }>; readonly files: ReplyFiles }) {
  const { attachment, files } = props;
  const [broken, setBroken] = useState(false);
  const { problem, busy, run } = useAction(files, attachment);
  if (broken) return <FileCard attachment={attachment} files={files} />;
  const src = files.url(attachment.id);
  return (
    <figure class={`reply-media ${attachment.kind}`}>
      {attachment.kind === 'image' ? (
        <button class="reply-image-button" title={`Open ${attachment.name}`} disabled={busy} onClick={() => { run('open'); }}>
          <img class="reply-image" src={src} alt={attachment.name} loading="lazy" onError={() => { setBroken(true); }} />
        </button>
      ) : (
        <video class="reply-video" src={src} controls preload="metadata" aria-label={attachment.name} onError={() => { setBroken(true); }} />
      )}
      <figcaption class="reply-media-caption">
        <span class="reply-file-name" title={attachment.name}>{attachment.name}</span>
        <span class="reply-file-meta">{problem ?? formatBytes(attachment.size)}</span>
        <button class="ghost" disabled={busy} aria-label={`Save ${attachment.name}`} onClick={() => { run('save'); }}>Save…</button>
      </figcaption>
    </figure>
  );
}

/** The files an agent attached to its reply: images and videos inline, every other file as a card to open or save. */
export function ReplyAttachments(props: { readonly attachments: readonly ReplyAttachment[]; readonly files: ReplyFiles }) {
  return (
    <div class="reply-attachments">
      {props.attachments.map((attachment) => {
        switch (attachment.kind) {
          case 'image':
          case 'video':
            return <Media key={attachment.id} attachment={attachment} files={props.files} />;
          case 'file':
            return <FileCard key={attachment.id} attachment={attachment} files={props.files} />;
        }
      })}
    </div>
  );
}
