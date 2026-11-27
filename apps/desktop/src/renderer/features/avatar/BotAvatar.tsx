import type { AgentAvatar } from '@morrowbot/contracts';
import { mountAvatar, type AvatarOptions, type MountedAvatar } from 'open-bot-avatar/dom';
import { useEffect, useId, useRef } from 'preact/hooks';
import { FinishFilter, hasFilter, materialOf } from './finish.tsx';
import type { AvatarMotion } from './motion.ts';
import { definitionOf } from './shapes.ts';

/** A resting avatar: no frames until something changes. */
export const RESTING: AvatarMotion = { state: 'idle', mood: 'neutral', paused: true };

function optionsOf(avatar: AgentAvatar, motion: AvatarMotion, label: string): AvatarOptions | undefined {
  const definition = definitionOf(avatar.shape);
  if (definition === undefined) return undefined;
  return {
    definition,
    color: avatar.color,
    material: materialOf(avatar.finish),
    state: motion.state,
    mood: motion.mood,
    // A paused avatar eases to rest and the engine's shared clock then sleeps; a moving one
    // still follows the system's reduced-motion setting.
    reducedMotion: motion.paused ? true : 'system',
    renderer: 'canvas',
    label,
  };
}

const keyOf = (avatar: AgentAvatar, motion: AvatarMotion, label: string): string =>
  [avatar.shape, avatar.color, avatar.finish, motion.state, motion.mood, String(motion.paused), label].join('|');

/** An agent's live avatar. `label` names it for screen readers; leave it empty where the agent's name is shown beside it. */
export function BotAvatar(props: { readonly avatar: AgentAvatar; readonly motion?: AvatarMotion; readonly size: number; readonly label?: string }) {
  const { avatar, size } = props;
  const motion = props.motion ?? RESTING;
  const label = props.label ?? '';
  const host = useRef<HTMLSpanElement>(null);
  const mounted = useRef<{ readonly avatar: MountedAvatar; key: string } | null>(null);
  const filterId = `bot-finish-${useId()}`;
  const key = keyOf(avatar, motion, label);

  useEffect(() => {
    const options = optionsOf(avatar, motion, label);
    if (host.current === null || options === undefined) return;
    mounted.current = { avatar: mountAvatar(host.current, options), key };
    return () => {
      mounted.current?.avatar.destroy();
      mounted.current = null;
    };
  }, []);

  useEffect(() => {
    const current = mounted.current;
    const options = optionsOf(avatar, motion, label);
    if (current === null || options === undefined || current.key === key) return;
    current.key = key;
    current.avatar.update(options);
  }, [key]);

  return (
    <span class={`bot-avatar finish-${avatar.finish}`} data-state={motion.state} style={{ width: `${String(size)}px`, height: `${String(size)}px` }}>
      <FinishFilter id={filterId} finish={avatar.finish} size={size} />
      <span ref={host} class="bot-avatar-engine" style={hasFilter(avatar.finish) ? { filter: `url(#${filterId})` } : {}} />
    </span>
  );
}
