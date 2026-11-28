import { HOST_TOOLS_SERVER } from '@morrowbot/contracts';

/** The mode (agent) for read-only turns: `build`, held to `READ_ONLY_PERMISSION` below. */
export const BUILD_MODE = 'build';

/** The mode (agent) for full-access turns: a primary agent whose permissions allow every tool without prompting. */
export const FULL_MODE = 'full';

const READ_ONLY_PERMISSION = {
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
};

/**
 * The opencode config every Ori Bot session runs under, given as `OPENCODE_CONFIG_CONTENT`.
 * Both the top-level `permission` and explicit `agent.build.permission` enforce read-only access
 * (so files in the shared config directory cannot loosen `build`), denying every tool except reads,
 * searches, listings, web fetch, and Ori Bot's own MCP server. The `full` primary agent overrides
 * those permissions to allow every tool without prompting for full-access turns. Other built-in
 * agents are disabled; language servers and formatters, which run code in the workspace, are off.
 */
const OPENCODE_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  autoupdate: false,
  share: 'disabled',
  lsp: false,
  formatter: false,
  agent: {
    [BUILD_MODE]: { permission: READ_ONLY_PERMISSION },
    plan: { disable: true },
    general: { disable: true },
    explore: { disable: true },
    [FULL_MODE]: { mode: 'primary', permission: { '*': 'allow' } },
  },
  permission: READ_ONLY_PERMISSION,
};

/**
 * The variables `opencode acp` runs with, on top of the runtime's. Its home, config, data, state and
 * cache folders are Ori Bot's own (under `dir`), so it reads none of the user's opencode settings,
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
