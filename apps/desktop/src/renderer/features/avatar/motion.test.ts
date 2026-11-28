import { expect, it } from 'vitest';
import { combineActivity, engineStill, motionOf, type AvatarActivity } from './motion.ts';
import { AVATARS } from './registry.ts';

const ACTIVITIES: readonly AvatarActivity[] = ['idle', 'queued', 'thinking', 'running-tool', 'streaming', 'needs-approval', 'completed'];

it('shows each activity as its own engine state and mood; only an idle avatar is paused, and Reduce motion stills them all', () => {
  const line = (activity: AvatarActivity): string => {
    const motion = motionOf(activity);
    return `${motion.state}/${motion.mood}${motion.paused ? ' paused' : ''} · engine ${String(engineStill(motion, false))}, reduced ${String(engineStill(motion, true))}`;
  };
  expect(Object.fromEntries(ACTIVITIES.map((activity) => [activity, line(activity)]))).toMatchInlineSnapshot(`
    {
      "completed": "done/happy · engine system, reduced true",
      "idle": "idle/neutral paused · engine true, reduced true",
      "needs-approval": "blocked/neutral · engine system, reduced true",
      "queued": "waiting/neutral · engine system, reduced true",
      "running-tool": "working/neutral · engine system, reduced true",
      "streaming": "working/happy · engine system, reduced true",
      "thinking": "thinking/neutral · engine system, reduced true",
    }
  `);
});

it("shows the chat that most needs showing among an agent's chats", () => {
  expect({
    none: combineActivity([]),
    restingAndDone: combineActivity(['idle', 'completed', 'idle']),
    doneAndQueued: combineActivity(['completed', 'queued']),
    thinkingAndStreaming: combineActivity(['thinking', 'streaming']),
    toolAndStreaming: combineActivity(['streaming', 'running-tool']),
    everything: combineActivity(ACTIVITIES),
  }).toMatchInlineSnapshot(`
    {
      "doneAndQueued": "queued",
      "everything": "needs-approval",
      "none": "idle",
      "restingAndDone": "completed",
      "thinkingAndStreaming": "streaming",
      "toolAndStreaming": "running-tool",
    }
  `);
});

it('draws every shape with one of the engine outlines', () => {
  expect(AVATARS.map(({ id, definition }) => `${id}: ${definition?.name ?? 'missing'}`)).toMatchInlineSnapshot(`
    [
      "chat: Chat",
      "controller: Controller",
      "barbell: Barbell",
      "mug: Mug",
      "lightbulb: Lightbulb",
      "sprout: Sprout",
      "watering-can: Watering Can",
    ]
  `);
});
