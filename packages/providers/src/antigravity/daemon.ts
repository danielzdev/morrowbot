import { acp, type StartJsonRpcProcess } from '@morrowbot/plugin-sdk';

export type AcpDaemon = acp.AcpClient;

export interface DaemonOptions {
  readonly cliPath: string;
  /** Where the daemon runs: the provider's own data folder. */
  readonly cwd: string;
  /** MorrowBot's own Antigravity folder, kept apart from the user's `~/.gemini`. */
  readonly geminiDir: string;
  readonly home: string | null;
  /** Hears, once, why this daemon broke the read-only rules, before it ends. */
  readonly onBreach: (reason: string) => void;
}

/**
 * Starts `agy acp` as this provider's shared daemon over the SDK's read-only ACP client.
 * `geminiDir` is MorrowBot's own Antigravity folder, so agy reads none of the user's settings,
 * permission grants, hooks, plugins or MCP servers; the Google sign-in is shared through the keychain.
 */
export async function startDaemon(jsonRpcProcess: StartJsonRpcProcess, options: DaemonOptions): Promise<acp.AcpStart> {
  return acp.startAcpClient(jsonRpcProcess, options.cliPath, {
    name: 'Antigravity',
    args: ['acp', '--gemini-dir', options.geminiDir],
    cwd: options.cwd,
    home: options.home,
    onBreach: (breach, version) => {
      options.onBreach(breachReason(breach, version));
    },
  });
}

/** What the user is told, and the profile is withheld with, after `breach`. */
function breachReason(breach: acp.Breach, version: string | null): string {
  const agy = version === null ? 'agy' : `agy ${version}`;
  const what = breach.kind === 'unasked-change' ? `ran "${breach.tool}" without asking` : `left its Default mode for "${breach.mode}"`;
  return `Antigravity (${agy}) ${what}. MorrowBot ended it and offers no Antigravity turns until the provider restarts.`;
}
