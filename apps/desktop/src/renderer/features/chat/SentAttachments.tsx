import type { Attachment } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';

function SentImage(props: { readonly attachment: Extract<Attachment, { kind: 'image' }>; readonly image: (id: string) => Promise<string | null> }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void props.image(props.attachment.id).then((loaded) => {
      if (live) setUrl(loaded);
    });
    return () => {
      live = false;
    };
  }, [props.attachment.id, props.image]);
  if (url === undefined) return <span class="sent-image loading" title={props.attachment.name} />;
  if (url === null) return <span class="sent-file" title="This image could not be loaded"><Icon name="warning" />{props.attachment.name}</span>;
  return <img class="sent-image" src={url} alt={props.attachment.name} title={props.attachment.name} />;
}

/** The files a user message carried: image thumbnails and text file names. */
export function SentAttachments(props: { readonly attachments: readonly Attachment[]; readonly image: (id: string) => Promise<string | null> }) {
  return (
    <div class="sent-attachments">
      {props.attachments.map((attachment) =>
        attachment.kind === 'image' ? (
          <SentImage key={attachment.id} attachment={attachment} image={props.image} />
        ) : (
          <span key={attachment.id} class="sent-file" title={attachment.name}><Icon name="file" />{attachment.name}</span>
        ),
      )}
    </div>
  );
}
