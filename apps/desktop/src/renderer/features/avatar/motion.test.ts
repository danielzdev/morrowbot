import { expect, it } from 'vitest';
import { combineActivity, motionOf, type AvatarActivity } from './motion.ts';
import { AVATARS } from './registry.ts';

const ACTIVITIES: readonly AvatarActivity[] = ['idle', 'queued', 'thinking', 'streaming', 'needs-approval', 'completed'];

it('shows each activity as an engine state; only an idle avatar is paused', () => {
  expect(Object.fromEntries(ACTIVITIES.map((activity) => [activity, motionOf(activity)]))).toMatchInlineSnapshot(`
    {
      "completed": {
        "mood": "happy",
        "paused": false,
        "state": "done",
      },
      "idle": {
        "mood": "neutral",
        "paused": true,
        "state": "idle",
      },
      "needs-approval": {
        "mood": "neutral",
        "paused": false,
        "state": "blocked",
      },
      "queued": {
        "mood": "neutral",
        "paused": false,
        "state": "waiting",
      },
      "streaming": {
        "mood": "neutral",
        "paused": false,
        "state": "working",
      },
      "thinking": {
        "mood": "neutral",
        "paused": false,
        "state": "thinking",
      },
    }
  `);
});

it("shows the chat that most needs showing among an agent's chats", () => {
  expect({
    none: combineActivity([]),
    restingAndDone: combineActivity(['idle', 'completed', 'idle']),
    doneAndQueued: combineActivity(['completed', 'queued']),
    thinkingAndStreaming: combineActivity(['thinking', 'streaming']),
    everything: combineActivity(ACTIVITIES),
  }).toMatchInlineSnapshot(`
    {
      "doneAndQueued": "queued",
      "everything": "needs-approval",
      "none": "idle",
      "restingAndDone": "completed",
      "thinkingAndStreaming": "streaming",
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
