import { stateDefinition, type AvatarMood, type AvatarState, type AvatarStateDefinition } from 'open-bot-avatar';

/** What an agent is doing, as its avatar shows it. */
export type AvatarActivity = 'idle' | 'queued' | 'thinking' | 'running-tool' | 'streaming' | 'needs-approval' | 'completed';

/** How the avatar moves. A paused avatar holds a calm pose and draws no frames. */
export interface AvatarMotion {
  readonly state: AvatarState | AvatarStateDefinition;
  readonly mood: AvatarMood;
  readonly paused: boolean;
}

const THINKING = stateDefinition('thinking');

/** The engine's thinking pose, looking up and away, with the body kept: its three dots alone read as a plain spinner. */
const PONDERING: AvatarStateDefinition = { id: 'pondering', pose: (ctx) => ({ ...THINKING.pose(ctx), marks: [] }) };

/** The state's name, as `data-state` and the tests show it. */
export const stateName = (motion: AvatarMotion): string => (typeof motion.state === 'string' ? motion.state : motion.state.id);

/**
 * Each activity has its own look: waiting in the queue, pondering while it thinks, bent over the work while a
 * tool runs, the same with a happy face while the reply streams, the exclamation mark while an approval
 * waits, and a celebration once it is done.
 */
export function motionOf(activity: AvatarActivity): AvatarMotion {
  switch (activity) {
    case 'idle':
      return { state: 'idle', mood: 'neutral', paused: true };
    case 'queued':
      return { state: 'waiting', mood: 'neutral', paused: false };
    case 'thinking':
      return { state: PONDERING, mood: 'neutral', paused: false };
    case 'running-tool':
      return { state: 'working', mood: 'neutral', paused: false };
    case 'streaming':
      return { state: 'working', mood: 'happy', paused: false };
    case 'needs-approval':
      return { state: 'blocked', mood: 'neutral', paused: false };
    case 'completed':
      return { state: 'done', mood: 'happy', paused: false };
  }
}

/** The engine's `reducedMotion`: still when paused or when Reduce motion is on, otherwise it follows the OS. */
export const engineStill = (motion: AvatarMotion, reducedMotion: boolean): true | 'system' => (motion.paused || reducedMotion ? true : 'system');

const PRIORITY: readonly AvatarActivity[] = ['needs-approval', 'running-tool', 'streaming', 'thinking', 'queued', 'completed', 'idle'];

/** An agent's activity across its chats: the one that most needs showing. */
export function combineActivity(activities: Iterable<AvatarActivity>): AvatarActivity {
  let best: AvatarActivity = 'idle';
  for (const activity of activities) if (PRIORITY.indexOf(activity) < PRIORITY.indexOf(best)) best = activity;
  return best;
}
