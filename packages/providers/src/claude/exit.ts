import type { CommandExit } from '@morrowbot/plugin-sdk';

/** Why a `claude` command gave no usable answer, for the user. */
export function describeExit(cliPath: string, exit: CommandExit, when = ''): string {
  switch (exit.kind) {
    case 'not-found':
      return `Claude Code CLI not found ("${cliPath}"). Install Claude Code, or set "Claude Code CLI path" in this plugin's settings.`;
    case 'failed':
      return `Could not start the Claude Code CLI ("${cliPath}"): ${exit.message}`;
    case 'exited': {
      const how = exit.signal === null ? `code ${String(exit.code)}` : `signal ${exit.signal}`;
      const stderr = exit.stderr.trim();
      return `Claude Code exited with ${how}${when}${stderr === '' ? '' : `: ${stderr}`}`;
    }
  }
}
