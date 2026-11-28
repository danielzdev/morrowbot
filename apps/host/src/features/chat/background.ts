import { collaboratorPrompt, MAX_EXCHANGE_MESSAGES, type AgentMessage } from '@morrowbot/contracts';

/** A line an agent writes, alone, in a background turn: what follows it is shown to the user. */
export const NOTIFY_USER_LINE = '[[notify-user]]';

/** Whether the recipient's answer to `message` goes back to its sender: it asks for one, and the exchange has room. */
export function answersSender(message: AgentMessage): boolean {
  return message.expectsReply && message.depth + 1 < MAX_EXCHANGE_MESSAGES;
}

/** What the recipient reads in a background turn: where its answer goes, how to tell the user, then the fenced message. */
export function backgroundPrompt(message: AgentMessage, senderName: string): string {
  const sender = `"${senderName.replaceAll('"', "'")}"`;
  const answer = answersSender(message)
    ? `Your answer is sent to ${sender} as your reply.`
    : message.expectsReply
      ? `This exchange reached its limit of ${String(MAX_EXCHANGE_MESSAGES)} messages, so nothing you write is sent to ${sender}.`
      : `Nothing you write is sent to ${sender}.`;
  return [
    `You are reading a message from another agent in the background: the user does not see this turn. ${answer}`,
    `To tell the user something, write a line that says only ${NOTIFY_USER_LINE}; everything after it is shown to the user as your message.`,
    '',
    collaboratorPrompt(message, senderName),
  ].join('\n');
}

/** A background turn's text, split at the first notify line. Each part is '' when there is none. */
export interface BackgroundAnswer {
  readonly reply: string;
  readonly notice: string;
}

export function splitAnswer(text: string): BackgroundAnswer {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.trim() === NOTIFY_USER_LINE);
  if (at === -1) return { reply: text.trim(), notice: '' };
  return { reply: lines.slice(0, at).join('\n').trim(), notice: lines.slice(at + 1).join('\n').trim() };
}
