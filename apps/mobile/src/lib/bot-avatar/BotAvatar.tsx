import type { AgentAvatar } from '@morrowbot/contracts';
import { createAnimator, type AvatarDefinition, type AvatarFrame } from 'open-bot-avatar';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useReduceMotion } from '../reduce-motion.ts';
import { frameOf, stillPose, type FramePose } from './frame.ts';
import { FrameSvg } from './FrameSvg.tsx';
import { motionOf, type AvatarActivity, type AvatarMotion } from './motion.ts';
import { definitionOf } from './outline.ts';

/** A still avatar's view: the body with a little room for its rest pose. */
const STILL_VIEW = '-3 -3 106 106';
/** A moving avatar draws this much wider each side, as a share of `size`, so ribbons and hops are not cut off. */
const REACH = 0.3;
const LIVE_VIEW = `${String(-REACH * 100)} ${String(-REACH * 100)} ${String(100 + 2 * REACH * 100)} ${String(100 + 2 * REACH * 100)}`;
const FRAME_MS = 1000 / 30;

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

function Moving(props: { readonly definition: AvatarDefinition; readonly avatar: AgentAvatar; readonly size: number; readonly motion: AvatarMotion }) {
  const { definition, avatar, size } = props;
  const motion = useRef(props.motion);
  motion.current = props.motion;
  const animator = useMemo(createAnimator, []);
  const frameAt = (now: number): AvatarFrame => {
    const { state, mood } = motion.current;
    const step = animator.step({ now, state, mood, target: null, reducedMotion: false });
    const pose: FramePose = { state, mood, time: now / 1000, stateAge: step.stateAge, motionBlend: step.motionBlend, gaze: step.gaze, still: false };
    return frameOf(definition, avatar, pose, size);
  };
  const [frame, setFrame] = useState(() => frameAt(performance.now()));
  useEffect(() => {
    let handle = 0;
    let last = 0;
    const tick = () => {
      const now = performance.now();
      if (now - last >= FRAME_MS) {
        last = now;
        setFrame(frameAt(now));
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [definition, avatar, size]);
  const wide = size * (1 + 2 * REACH);
  return (
    <View style={{ margin: -size * REACH }}>
      <FrameSvg frame={frame} finish={avatar.finish} size={wide} viewBox={LIVE_VIEW} />
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
