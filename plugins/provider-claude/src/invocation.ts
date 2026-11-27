import { commandFilePath, type TurnMode, type TurnRequest } from '@morrowbot/plugin-sdk';

/** The access levels Claude Code runs in v1. There is no `full` (unsandboxed shell) profile. */
export type ClaudeAccess = 'read-only' | 'workspace-write';

export interface Invocation {
  readonly args: readonly string[];
  /** The one stream-json user frame of the turn, sent on stdin so the prompt never shows up in the process list. */
  readonly frame: string;
  /** The system prompt, if any, read by the CLI as a file for the same reason. */
  readonly files: readonly string[];
}

/**
 * `--input-format stream-json` keeps stdin open after the prompt, so the CLI can ask for approvals
 * there. `--no-session-persistence`: Claude is stateless in v1, and every turn sends the thread.
 */
const BASE = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--no-session-persistence',
] as const;

/** MorrowBot owns the instructions: no CLAUDE.md, skills, plugins, hooks or MCP servers of the user's. */
const ISOLATED = ['--safe-mode', '--strict-mcp-config'] as const;

/**
 * `--restricted` removes every tool that runs commands, ignores the user, project and local settings
 * files, and confines the file tools to the working folder. `--tools` names the only tools offered.
 */
function accessFlags(access: ClaudeAccess, mode: TurnMode): readonly string[] {
  switch (access) {
    case 'read-only':
      return ['--restricted', '--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--permission-prompts', 'none'];
    case 'workspace-write':
      return [
        '--restricted',
        '--tools',
        'Read,Glob,Grep,Edit,Write',
        '--permission-mode',
        'acceptEdits',
        ...approvalFlags(mode),
      ];
  }
}

/**
 * Edits inside the folder go ahead; protected paths such as `.git/` would prompt. Interactive turns
 * get those prompts as `can_use_tool` control requests on stdout (`--permission-prompt-tool stdio`,
 * which `claude --help` does not list); background turns deny them without asking.
 */
function approvalFlags(mode: TurnMode): readonly string[] {
  switch (mode) {
    case 'interactive':
      return ['--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'];
    case 'background':
      return ['--permission-prompts', 'none'];
  }
}

/** Builds the `claude` command line and stdin frame for one stateless turn. */
export function buildInvocation(
  request: Pick<TurnRequest, 'mode' | 'selection' | 'system' | 'prompt'> & { readonly access: ClaudeAccess; readonly seed: string | null },
): Invocation {
  const { selection, system } = request;
  return {
    args: [
      ...BASE,
      ...ISOLATED,
      ...accessFlags(request.access, request.mode),
      ...(selection.kind === 'model' ? ['--model', selection.id] : []),
      ...(system === null ? [] : ['--append-system-prompt-file', commandFilePath(0)]),
    ],
    frame: `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt(request.seed, request.prompt) } })}\n`,
    files: system === null ? [] : [system],
  };
}

/** The host renders `seed` as `<user>` / `<assistant>` blocks; the new prompt is the last user block. */
function prompt(seed: string | null, text: string): string {
  if (seed === null || seed === '') return text;
  return `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${text}\n</user>\n</conversation>`;
}
