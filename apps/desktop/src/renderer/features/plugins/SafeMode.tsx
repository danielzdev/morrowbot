import { useEffect, useRef } from 'preact/hooks';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { SAFE_MODE_LINE } from './plugin-health.ts';

/** The banner while safe mode is on (spec IA §3). The sidebar's alert dot focuses it. */
export function SafeModeBanner(props: { readonly focus: boolean; readonly onRestartNormally: () => void }) {
  const banner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.focus) banner.current?.focus();
  }, [props.focus]);
  return (
    <div ref={banner} class="banner warning safe-mode-banner" role="status" tabIndex={-1}>
      <span>
        <strong>{SAFE_MODE_LINE}</strong> Built-in providers still work, so you can keep chatting.
      </span>
      <button type="button" class="btn secondary" onClick={props.onRestartNormally}>
        Restart normally
      </button>
    </div>
  );
}

/**
 * "Start without extensions" (spec §6.3, IA §3 ⋯ menu): the choice is saved for the next launch and
 * applies on Restart. It never switches while running.
 */
export function SafeModeDialog(props: { readonly safeMode: boolean; readonly onRestart: (safeMode: boolean) => void; readonly onCancel: () => void }) {
  return props.safeMode ? (
    <ConfirmDialog
      title="Restart normally?"
      body="MorrowBot restarts and starts your extensions again."
      confirmLabel="Restart MorrowBot"
      tone="primary"
      onCancel={props.onCancel}
      onConfirm={() => {
        props.onRestart(false);
      }}
    />
  ) : (
    <ConfirmDialog
      title="Start without extensions?"
      body={
        <>
          <p>MorrowBot restarts in safe mode: no plugin or connector starts, so you can turn off one that is causing trouble.</p>
          <p>Built-in providers keep working, so your agents can still chat. Safe mode stays on until you restart normally.</p>
        </>
      }
      confirmLabel="Restart in safe mode"
      tone="primary"
      onCancel={props.onCancel}
      onConfirm={() => {
        props.onRestart(true);
      }}
    />
  );
}
