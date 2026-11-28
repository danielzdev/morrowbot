import { useState } from 'preact/hooks';
import type { UpdateStatus } from '../bridge.ts';

/** A quiet bar once an update has downloaded: restart now, or later (it also installs on the next quit). */
export function UpdateBanner(props: { readonly status: UpdateStatus; readonly onRestart: () => void }) {
  const [later, setLater] = useState<string | null>(null);
  const { status } = props;
  if (status.kind !== 'ready' || later === status.version) return null;
  return (
    <div class="banner update" role="status">
      <span class="banner-text">
        Update ready <span class="banner-detail">· Ori Bot {status.version}</span>
      </span>
      <span class="banner-actions">
        <button type="button" class="btn ghost" onClick={() => { setLater(status.version); }}>
          Later
        </button>
        <button type="button" class="btn primary" onClick={props.onRestart}>
          Restart to update
        </button>
      </span>
    </div>
  );
}
