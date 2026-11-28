import type { AgentAvatar } from '@morrowbot/contracts';
import { createAnimator, type Animator, type AvatarDefinition, type AvatarFrame } from 'open-bot-avatar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useReduceMotion } from '../reduce-motion.ts';
import { frameOf, stillPose, type FramePose } from './frame.ts';
import { FrameSvg } from './FrameSvg.tsx';
import { motionOf, type AvatarActivity, type AvatarMotion } from './motion.ts';
import { definitionOf } from './outline.ts';

/** Units of the avatar's 100-unit box across `size` points: the body with a little room for its rest pose. */
const SPAN = 106;
/** A moving avatar draws this much wider each side, as a share of `size`, so ribbons and hops are not cut off. */
const REACH = 0.3;
/** A square view of `span` units about the box's centre. */
const viewOf = (span: number): string => `${String(50 - span / 2)} ${String(50 - span / 2)} ${String(span)} ${String(span)}`;
const STILL_VIEW = viewOf(SPAN);
const LIVE_VIEW = viewOf(SPAN * (1 + 2 * REACH));
const FRAME_MS = 1000 / 30;
/** How early a display refresh may come and still draw the next frame, so 60 Hz refreshes give an even 30 fps. */
const FRAME_SLACK_MS = 4;

function Fallback(props: { readonly color: string; readonly size: number }) {
  return <View style={{ width: props.size, height: props.size, borderRadius: props.size / 2, backgroundColor: props.color }} />;
}

function Hidden(props: { readonly size: number; readonly children: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: props.size, height: props.size }}
    >
      {props.children}
    </View>
  );
}

function Still(props: { readonly definition: AvatarDefinition; readonly avatar: AgentAvatar; readonly size: number; readonly motion: AvatarMotion }) {
  const { definition, avatar, size, motion } = props;
  const { shape, color, finish } = avatar;
  const { state, mood } = motion;
  const frame = useMemo(() => frameOf(definition, { kind: 'bot', shape, color, finish }, stillPose(state, mood), size), [definition, shape, color, finish, size, state, mood]);
  return <FrameSvg frame={frame} finish={avatar.finish} size={size} viewBox={STILL_VIEW} />;
}

/** An agent's avatar at rest, as rows and headers show it: one still frame, no timers. */
export function BotAvatar(props: { readonly avatar: AgentAvatar; readonly size: number }) {
  const definition = definitionOf(props.avatar.shape);
  return (
    <Hidden size={props.size}>
      {definition === undefined ? (
        <Fallback color={props.avatar.color} size={props.size} />
      ) : (
        <Still definition={definition} avatar={props.avatar} size={props.size} motion={motionOf('idle')} />
      )}
    </Hidden>
  );
}

/** An animator that has just shown the avatar at rest, so every activity, `completed` too, starts afresh as it mounts. */
function freshAnimator(now: number): Animator {
  const animator = createAnimator();
  const { state, mood } = motionOf('idle');
  animator.step({ now, state, mood, target: null, reducedMotion: false });
  return animator;
}

function Moving(props: { readonly definition: AvatarDefinition; readonly avatar: AgentAvatar; readonly size: number; readonly motion: AvatarMotion }) {
  const { definition, size } = props;
  const { shape, color, finish } = props.avatar;
  const motion = useRef(props.motion);
  useLayoutEffect(() => {
    motion.current = props.motion;
  });
  const [animator] = useState(() => freshAnimator(performance.now()));
  const frameAt = useCallback(
    (now: number): AvatarFrame => {
      const { state, mood } = motion.current;
      const step = animator.step({ now, state, mood, target: null, reducedMotion: false });
      const pose: FramePose = { state, mood, time: now / 1000, stateAge: step.stateAge, motionBlend: step.motionBlend, gaze: step.gaze, still: false };
      return frameOf(definition, { kind: 'bot', shape, color, finish }, pose, size);
    },
    [animator, definition, shape, color, finish, size],
  );
  const [frame, setFrame] = useState(() => frameAt(performance.now()));
  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (now - last >= FRAME_MS - FRAME_SLACK_MS) {
        last = now;
        setFrame(frameAt(now));
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [frameAt]);
  const wide = size * (1 + 2 * REACH);
  return (
    <View style={{ margin: -size * REACH }}>
      <FrameSvg frame={frame} finish={finish} size={wide} viewBox={LIVE_VIEW} />
    </View>
  );
}

/**
 * The agent's avatar acting out `activity`, for the running turn in a chat. It draws frames only while mounted,
 * so the chat unmounts it once the turn is over. Under Reduce Motion it holds the activity's pose still.
 */
export function LiveBotAvatar(props: { readonly avatar: AgentAvatar; readonly size: number; readonly activity: AvatarActivity }) {
  const reduceMotion = useReduceMotion();
  const definition = definitionOf(props.avatar.shape);
  const motion = motionOf(props.activity);
  return (
    <Hidden size={props.size}>
      {definition === undefined ? (
        <Fallback color={props.avatar.color} size={props.size} />
      ) : reduceMotion || motion.paused ? (
        <Still definition={definition} avatar={props.avatar} size={props.size} motion={motion} />
      ) : (
        <Moving definition={definition} avatar={props.avatar} size={props.size} motion={motion} />
      )}
    </Hidden>
  );
}
