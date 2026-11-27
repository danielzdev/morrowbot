/** The one mode (agent) MorrowBot runs: `build`, held to the read-only permissions below. */
export const BUILD_MODE = 'build';

/**
 * The opencode config every MorrowBot session runs under, given as `OPENCODE_CONFIG_CONTENT`. Every
 * tool is denied, so opencode never offers the model a write, edit, shell, task or skill tool;
 * reads, searches and listings inside the workspace are allowed; a read outside it, an `.env` file,
 * and a web fetch or search ask first, which MorrowBot turns into an approval card. The other
 * built-in agents are disabled, so a session cannot switch to one with other permissions; language
 * servers and formatters, which run code in the workspace, are off (checked on opencode 2.4.1).
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
    websearch: 'ask',
    codesearch: 'ask',
  },
};

/**
 * The variables `opencode acp` runs with, on top of the runtime's. Its config, data, state and
 * cache folders are MorrowBot's own (under `dir`), so it reads none of the user's opencode settings,
 * plugins, MCP servers or sign-ins: only the free models need none. It loads nothing from the
 * workspace (`opencode.json`, `.opencode/`, `AGENTS.md`), nor Claude Code's `~/.claude` files, and
 * never updates itself (checked on opencode 2.4.1).
 */
export function agentEnv(dir: string): Readonly<Record<string, string>> {
  return {
    XDG_CONFIG_HOME: `${dir}/config`,
    XDG_DATA_HOME: `${dir}/data`,
    XDG_STATE_HOME: `${dir}/state`,
    XDG_CACHE_HOME: `${dir}/cache`,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(READ_ONLY_CONFIG),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  };
}
