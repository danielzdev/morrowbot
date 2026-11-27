import { commandFilePath, type TurnRequest } from '@morrowbot/plugin-sdk';

export interface Invocation {
  readonly args: readonly string[];
  /** The prompt, sent on stdin so it never shows up in the process list. */
  readonly input: string;
  /** The system prompt, if any, read by the CLI as a file for the same reason. */
  readonly files: readonly string[];
}

/**
 * The one profile v1 offers: read-only and isolated. `--safe-mode --strict-mcp-config --restricted`
 * turn off the user's CLAUDE.md, skills, plugins, hooks, MCP servers and settings files; the file
 * tools are only Read, Glob and Grep, and anything else is denied without asking.
 */
const READ_ONLY_ISOLATED = [
  '--safe-mode',
  '--strict-mcp-config',
  '--restricted',
  '--tools',
  'Read,Glob,Grep',
  '--permission-mode',
  'dontAsk',
  '--permission-prompts',
  'none',
] as const;

/** Builds the `claude` command line and stdin for one stateless turn. */
export function buildInvocation(request: Pick<TurnRequest, 'selection' | 'system' | 'prompt'> & { readonly seed: string | null }): Invocation {
  const { selection, system } = request;
  return {
    args: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--no-session-persistence',
      ...READ_ONLY_ISOLATED,
      ...(selection.kind === 'model' ? ['--model', selection.id] : []),
      ...(system === null ? [] : ['--append-system-prompt-file', commandFilePath(0)]),
    ],
    input: prompt(request.seed, request.prompt),
    files: system === null ? [] : [system],
  };
}

/** The host renders `seed` as `<user>` / `<assistant>` blocks; the new prompt is the last user block. */
function prompt(seed: string | null, text: string): string {
  if (seed === null || seed === '') return text;
  return `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${text}\n</user>\n</conversation>`;
}
