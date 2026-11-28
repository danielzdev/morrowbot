import { Icon } from '../../shared/ui/Icon.tsx';
import { formatBytes } from '../../shared/format.ts';
import type { ComposerAttachment } from './composer-attachments.ts';

/** The files waiting to go with the next message, each with a Remove button. */
export function AttachmentStrip(props: { readonly items: readonly ComposerAttachment[]; readonly onRemove: (key: number) => void }) {
  if (props.items.length === 0) return null;
  return (
    <ul class="attachment-strip" aria-label="Attached files">
      {props.items.map((item) => {
        const name = item.kind === 'ready' ? item.attachment.name : item.name;
        const preview = item.kind === 'failed' ? null : item.preview;
        const note = item.kind === 'uploading' ? 'Uploading…' : item.kind === 'failed' ? item.reason : formatBytes(item.attachment.size);
        return (
          <li key={item.key} class={`attachment-chip ${item.kind}`} title={name}>
            {preview === null ? (
              <span class="attachment-icon" aria-hidden="true"><Icon name={item.kind === 'failed' ? 'warning' : 'file'} /></span>
            ) : (
              <img class="attachment-thumb" src={preview} alt="" />
            )}
            <span class="attachment-text">
              <span class="attachment-name">{name}</span>
              <span class="attachment-note" role={item.kind === 'failed' ? 'alert' : undefined}>{note}</span>
            </span>
            <button class="icon-btn attachment-remove" aria-label={`Remove ${name}`} title="Remove" onClick={() => { props.onRemove(item.key); }}>
              <Icon name="close" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
