import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ChatActivity } from './activity.ts';
import type { ChatDisplay } from './display.ts';
import type { ActiveTurnView } from './thread-model.ts';
import { elapsed } from './tool-rows.ts';
import { extraDetail, labelExpiresAt, phaseOf, progressOf, switchIn, type HeldLabel } from './turn-phase.ts';

/** Time since `startedAt`, ticking each second. */
export function Since({ startedAt }: { readonly startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1_000);
    return () => { clearInterval(timer); };
  }, []);
  return <>{elapsed(now - startedAt)}</>;
}

/** `wanted`, once the label before it has shown for its minimum time; the latest wanted label wins. */
function useHeldLabel(wanted: string): string {
  const [held, setHeld] = useState<HeldLabel>(() => ({ label: wanted, since: Date.now() }));
  useEffect(() => {
    const wait = switchIn(held, wanted, Date.now());
    if (wait === null) return;
    const timer = setTimeout(() => { setHeld({ label: wanted, since: Date.now() }); }, wait);
    return () => { clearTimeout(timer); };
  }, [wanted, held]);
  return held.label;
}

/** The running turn's sticky row: the avatar, what it is doing, how far along it is, the timer and the provider's status. */
export function TurnStatus(props: {
  readonly turn: ActiveTurnView;
  readonly display: ChatDisplay;
  readonly avatar: (activity: ChatActivity) => ComponentChildren;
  /** Tool rows show below, so the row leaves out its step count. */
  readonly tools: boolean;
}) {
  const { turn, display } = props;
  const [, rerender] = useState(0);
  const { phase, label: wanted } = phaseOf(turn, display, Date.now());
  const label = useHeldLabel(wanted);
  const expires = labelExpiresAt(turn);
  useEffect(() => {
    if (expires === null) return;
    const timer = setTimeout(() => { rerender((count) => count + 1); }, Math.max(0, expires - Date.now()));
    return () => { clearTimeout(timer); };
  }, [expires]);
  const queued = turn.state === 'queued';
  const detail = queued ? (turn.queueNote ?? 'Waiting for a free slot') : extraDetail(turn.detail, label);
  const progress = props.tools || queued ? null : progressOf(turn);
  return (
    <div class={`turn-time turn-phase ${phase}`}>
      <span class="turn-avatar" aria-hidden="true">{props.avatar(phase)}</span>
      <span key={label} class="turn-label">{label}</span>
      {progress !== null && <span class="turn-progress"> · {progress}</span>}
      {!queued && turn.startedAt !== null && <span> · <Since startedAt={turn.startedAt} /></span>}
      {detail !== null && <span class="turn-detail"> · {display.safe(detail) ?? ''}</span>}
    </div>
  );
}
