import type { AvatarMood, AvatarState } from 'open-bot-avatar';

/** What an agent is doing, as its avatar shows it. */
export type AvatarActivity = 'idle' | 'queued' | 'thinking' | 'streaming' | 'needs-approval' | 'completed';

/** How the avatar moves. A paused avatar holds a calm pose and draws no frames. */
export interface AvatarMotion {
  readonly state: AvatarState;
  readonly mood: AvatarMood;
  readonly paused: boolean;
}

export function motionOf(activity: AvatarActivity): AvatarMotion {
  switch (activity) {
    case 'idle':
      return { state: 'idle', mood: 'neutral', paused: true };
    case 'queued':
      return { state: 'waiting', mood: 'neutral', paused: false };
    case 'thinking':
      return { state: 'thinking', mood: 'neutral', paused: false };
    case 'streaming':
      return { state: 'working', mood: 'neutral', paused: false };
    case 'needs-approval':
      return { state: 'blocked', mood: 'neutral', paused: false };
    case 'completed':
      return { state: 'done', mood: 'happy', paused: false };
  }
}

const PRIORITY: readonly AvatarActivity[] = ['needs-approval', 'streaming', 'thinking', 'queued', 'completed', 'idle'];

/** An agent's activity across its chats: the one that most needs showing. */
export function combineActivity(activities: Iterable<AvatarActivity>): AvatarActivity {
  let best: AvatarActivity = 'idle';
  for (const activity of activities) if (PRIORITY.indexOf(activity) < PRIORITY.indexOf(best)) best = activity;
  return best;
}
