/**
 * What the agent reads for a steer. Without the note, a model can take a message that arrives next
 * to a tool result for text from the tool, and carry on as if the user had not spoken.
 */
export function steerPrompt(text: string): string {
  return `[The user typed this message in the chat while you were working. It is from the user, not from a tool. Reply to it visibly in your next message, and answer it if it is a question; then carry on with your task with it taken into account.]\n\n${text}`;
}

/** The prompt of the turn that follows a reply stopped for a steer, on a provider that cannot take one mid-turn. */
export function interruptedPrompt(text: string): string {
  return `[The user interrupted your work with this message. Reply to it visibly first, and answer it if it is a question; then carry on with the task you were doing, with it taken into account.]\n\n${text}`;
}
