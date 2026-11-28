import { HOST_TOOLS_SERVER } from '@morrowbot/contracts';

/** The one mode (agent) MorrowBot runs: `build`, held to the read-only permissions below. */
export const BUILD_MODE = 'build';

/**
 * The opencode config every MorrowBot session runs under, given as `OPENCODE_CONFIG_CONTENT`. Every
 * tool is denied, so opencode never offers the model a write, edit, shell or task tool; it still
 * offers `skill`, which is denied and finds no skills. Reads, searches and listings inside the
 * workspace are allowed; a read outside it, an `.env` file and a web fetch ask first, which
 * MorrowBot turns into an approval card. Web and code search are denied: opencode reports them as
 * a tool of no kind, which MorrowBot always refuses. MorrowBot's own tools (its MCP server, which acts
 * only as the turn's agent) are allowed. The other built-in agents are disabled, so a
 * session cannot switch to one with other permissions; language servers and formatters, which run
 * code in the workspace, are off (checked on opencode 2.4.1).
 */
const READ_ONLY_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  autoupdate: false,
  share: 'disabled',
  lsp: false,
  formatter: false,
  agent: { plan: { disable: true }, general: { disable: true }, explore: { disable: true } },
  permission: {
    '*': 'deny',
    read: { '*': 'allow', '*.env': 'ask', '*.env.*': 'ask', '*.env.example': 'allow' },
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    external_directory: 'ask',
    webfetch: 'ask',
    websearch: 'deny',
    codesearch: 'deny',
    [`${HOST_TOOLS_SERVER}_*`]: 'allow',
  },
};

/**
 * The variables `opencode acp` runs with, on top of the runtime's. Its home, config, data, state and
 * cache folders are MorrowBot's own (under `dir`), so it reads none of the user's opencode settings,
 * plugins, MCP servers, skills (`~/.agents`, `~/.opencode`) or sign-ins: only the free models need
 * none. It loads no config from the workspace (`opencode.json`, `.opencode/`, its top `AGENTS.md`),
 * nor Claude Code's files, and never updates itself (checked on opencode 2.4.1).
 */
export function agentEnv(dir: string): Readonly<Record<string, string>> {
  return {
    HOME: `${dir}/home`,
    XDG_CONFIG_HOME: `${dir}/config`,
    XDG_DATA_HOME: `${dir}/data`,
    XDG_STATE_HOME: `${dir}/state`,
    XDG_CACHE_HOME: `${dir}/cache`,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(READ_ONLY_CONFIG),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  };
}
