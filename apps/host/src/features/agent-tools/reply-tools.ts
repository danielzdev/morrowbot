import { Emoji } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolPorts } from './ports.ts';
import { done, refused, tool, type Tool, type ToolResult } from './tool.ts';

/** Tools for answering the user without a forced text reply: an emoji reaction, or no message at all. */
export function replyTools({ replies }: ToolPorts): Tool[] {
  return [
    tool({
      name: 'react_to_message',
      description:
        'Reacts with one emoji (such as 👍, ❤️ or 🎉) to the user’s message you are answering; the user sees it under their message. Use it for a short acknowledgement or go-ahead ("sounds good", "thanks"). Then carry on with the work, or end with stay_quiet when the reaction says it all.',
      input: z.strictObject({ emoji: Emoji.describe('One complete emoji, such as 👍 or ❤️.') }),
      run: (grant, { emoji }) => result(replies.react(grant, emoji)),
    }),
    tool({
      name: 'stay_quiet',
      description:
        'Ends this turn with no message in the chat: no reply bubble and no unread badge for the user. Use it when a text reply would only be filler, such as after react_to_message, or when the user’s reaction to your message needs no answer. Write nothing after calling it: nothing you write in this turn is shown. Refused when the user turned emoji-only and silent replies off for you; then answer with text.',
      input: z.strictObject({}),
      run: (grant) => result(replies.stayQuiet(grant)),
    }),
  ];
}

function result(answer: ReturnType<ToolPorts['replies']['stayQuiet']>): ToolResult {
  switch (answer.kind) {
    case 'done':
      return done(answer.value);
    case 'refused':
      return refused(answer.reason);
  }
}
