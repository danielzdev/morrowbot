import type { ChatMessage, ProviderStreamRequest } from '@morrowbot/plugin-sdk';
import type { Settings } from './settings.ts';

/** The `model` setting that leaves the choice to Claude Code's own default. */
export const DEFAULT_MODEL = 'default';

export interface Invocation {
  readonly args: readonly string[];
  /** The prompt, sent on stdin so it never shows up in the process list. */
  readonly input: string;
}

/** Builds the `claude` command line for one reply. Throws when the request does not end with a user message. */
export function buildInvocation(request: ProviderStreamRequest, settings: Settings): Invocation {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content);
  const turns = request.messages.filter((message) => message.role !== 'system');
  if (turns.at(-1)?.role !== 'user') throw new Error('The last message must come from the user');
  return {
    args: [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--no-session-persistence',
      ...(settings.model === DEFAULT_MODEL ? [] : ['--model', settings.model]),
      ...(system.length === 0 ? [] : ['--append-system-prompt', system.join('\n\n')]),
    ],
    input: prompt(turns),
  };
}

function prompt(turns: readonly ChatMessage[]): string {
  const [only] = turns;
  if (turns.length === 1 && only !== undefined) return only.content;
  const transcript = turns.map(({ role, content }) => `<${role}>\n${content}\n</${role}>`).join('\n');
  return `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${transcript}\n</conversation>`;
}
