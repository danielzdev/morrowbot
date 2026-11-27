import type { BlockedGroup } from '@morrowbot/contracts';

/** Process groups from earlier work that block new turns; Release anyway is offered after 60 s. */
export function BlockedBanner(props: { readonly groups: readonly BlockedGroup[]; readonly onRelease: (regId: string) => void; readonly busy?: boolean }) {
  if (props.groups.length === 0) return null;
  return (
    <div class="banner warning">
      {props.groups.map((group) => (
        <div key={group.regId} class="banner-row">
          <span>
            {group.releasable
              ? `A previous MorrowBot process is still running (pgid ${String(group.pgid)}). End it, or release it anyway.`
              : 'Waiting for an earlier provider process to exit…'}
          </span>
          {group.releasable && (
            <button class="secondary" disabled={props.busy} onClick={() => { props.onRelease(group.regId); }}>
              Release anyway
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
