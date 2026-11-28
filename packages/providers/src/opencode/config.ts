import { HOST_TOOLS_SERVER } from '@morrowbot/contracts';

/** The mode (agent) for read-only turns: `build`, held to the top-level read-only permissions below. */
export const BUILD_MODE = 'build';

/** The mode (agent) for full-access turns: a primary agent whose permissions allow every tool without prompting. */
export const FULL_MODE = 'full';

/**
 * The opencode config every MorrowBot session runs under, given as `OPENCODE_CONFIG_CONTENT`.
 * The default `build` agent inherits the top-level read-only permissions (every tool denied except
 * reads, searches, listings, web fetch, and MorrowBot's own MCP server; external reads, `.env`,
 * and web fetch ask first). The `full` primary agent overrides those permissions to allow every
 * tool without prompting for full-access turns. The other built-in agents are disabled; language
 * servers and formatters, which run code in the workspace, are off (checked on opencode 2.4.1).
 */
const OPENCODE_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  autoupdate: false,
  share: 'disabled',
  lsp: false,
  formatter: false,
  agent: {
    plan: { disable: true },
    general: { disable: true },
    explore: { disable: true },
    [FULL_MODE]: { mode: 'primary', permission: { '*': 'allow' } },
  },
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
    OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_CONFIG),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  };
}
