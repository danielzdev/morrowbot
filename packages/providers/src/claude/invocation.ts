import { HOST_TOOLS_SERVER } from '@morrowbot/contracts';
import { commandFilePath, type HostTools, type TurnMode, type TurnRequest } from '@morrowbot/plugin-sdk';

type AccessLevel = TurnRequest['access'];
import type { EffortLevel } from './info.ts';

export interface Invocation {
  readonly args: readonly string[];
  /** The one stream-json user frame of the turn, sent on stdin so the prompt never shows up in the process list. */
  readonly frame: string;
  /** The system prompt and Ori Kami's MCP server config, if any, read by the CLI as files for the same reason. */
  readonly files: readonly string[];
}

/**
 * `--input-format stream-json` keeps stdin open after the prompt, so the CLI can ask for approvals
 * there and take steers. `--replay-user-messages` echoes each stdin message once the CLI has taken
 * it: that echo is a steer's delivery. `--no-session-persistence`: Claude is stateless in v1, and
 * every turn sends the thread.
 */
const BASE = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--replay-user-messages',
  '--no-session-persistence',
] as const;

/**
 * Ori Kami owns the instructions: no CLAUDE.md, skills, commands, plugins, hooks or MCP servers of the
 * user's. `--setting-sources ''` skips CLAUDE.md and the settings files that hold hooks and plugins;
 * `--strict-mcp-config` every MCP server but Ori Kami's own; `--disable-slash-commands` the skills and
 * commands. Not `--safe-mode`: it drops `--mcp-config` servers too (checked on 2.1.332).
 */
const ISOLATED = ['--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'] as const;

/**
 * `--restricted` removes every tool that runs commands, ignores the user, project and local settings
 * files, and confines the file tools to the working folder. `--tools` names the only tools offered.
 * `full` has no `--restricted` (it refuses `bypassPermissions`): Bash and the file tools run anywhere
 * without asking, in either mode. Claude Code's own auto-memory, which `--restricted` keeps off, is
 * turned off with `--settings`: the agent's memories are Ori Kami's.
 */
function accessFlags(access: AccessLevel, mode: TurnMode): readonly string[] {
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
    case 'full':
      return [
        '--tools',
        'Read,Glob,Grep,Edit,Write,Bash',
        '--permission-mode',
        'bypassPermissions',
        '--permission-prompts',
        'none',
        '--settings',
        JSON.stringify({ autoMemoryEnabled: false }),
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

/**
 * Ori Kami's MCP server as a `--mcp-config` file, its tools allowed without asking (`mcp__orikami`
 * names them all). The token stays out of the process list.
 */
function hostToolsConfig(tools: HostTools): string | null {
  switch (tools.kind) {
    case 'none':
      return null;
    case 'mcp':
      return JSON.stringify({ mcpServers: { [HOST_TOOLS_SERVER]: { type: 'http', url: tools.url, headers: { Authorization: `Bearer ${tools.token}` } } } });
  }
}

/** Builds the `claude` command line and stdin frame for one stateless turn. */
export function buildInvocation(
  request: Pick<TurnRequest, 'access' | 'mode' | 'selection' | 'system' | 'prompt' | 'images' | 'hostTools'> & {
    readonly seed: string | null;
    /** Checked against the model's offered efforts already (`effortOf`). */
    readonly effort: EffortLevel | null;
  },
): Invocation {
  const { selection, system } = request;
  const tools = hostToolsConfig(request.hostTools);
  const files = [...(system === null ? [] : [system]), ...(tools === null ? [] : [tools])];
  return {
    args: [
      ...BASE,
      ...ISOLATED,
      ...accessFlags(request.access, request.mode),
      ...(selection.kind === 'model' ? ['--model', selection.id] : []),
      ...(request.effort === null ? [] : ['--effort', request.effort]),
      ...(system === null ? [] : ['--append-system-prompt-file', commandFilePath(0)]),
      ...(tools === null ? [] : ['--mcp-config', commandFilePath(files.length - 1), '--allowedTools', `mcp__${HOST_TOOLS_SERVER}`]),
    ],
    frame: `${JSON.stringify({ type: 'user', message: { role: 'user', content: content(prompt(request.seed, request.prompt), request.images) } })}\n`,
    files,
  };
}

/**
 * A steer as a stream-json user frame. Claude Code takes it at the next tool result, or as a second
 * reply in the same process when the first has already ended, and echoes it with this `uuid`.
 */
export function steerFrame(text: string, uuid: string): string {
  return `${JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } })}\n`;
}

/** A plain string, or with images the content blocks: the images first, then the text. */
function content(text: string, images: TurnRequest['images']): string | readonly Readonly<Record<string, unknown>>[] {
  if (images.length === 0) return text;
  return [...images.map(({ mimeType, data }) => ({ type: 'image', source: { type: 'base64', media_type: mimeType, data } })), { type: 'text', text }];
}

/** The host renders `seed` as `<user>` / `<assistant>` blocks; the new prompt is the last user block. */
function prompt(seed: string | null, text: string): string {
  if (seed === null || seed === '') return text;
  return `Continue this conversation. Reply to the last user message.\n\n<conversation>\n${seed}\n<user>\n${text}\n</user>\n</conversation>`;
}
