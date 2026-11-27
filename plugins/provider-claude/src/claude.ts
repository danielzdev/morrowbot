import {
  runCommand,
  z,
  type CommandExit,
  type FinishReason,
  type PluginHealth,
  type ProviderStreamRequest,
  type StreamSink,
} from '@morrowbot/plugin-sdk';
import { buildInvocation } from './invocation.ts';
import type { Settings } from './settings.ts';
import { parseCliLine, type CliResult } from './stream-json.ts';

const HEALTH_TIMEOUT_MS = 3_000;

const AuthStatus = z.looseObject({ loggedIn: z.boolean() });

/** Streams one reply from the `claude` CLI. Aborting the sink's signal stops the CLI. */
export async function streamReply(
  request: ProviderStreamRequest,
  settings: Settings,
  sink: StreamSink,
): Promise<FinishReason> {
  const { args, input, files } = buildInvocation(request, settings);
  let result: CliResult | undefined;
  const exit = await runCommand(settings.cliPath, {
    args,
    cwd: settings.cwd,
    input,
    files,
    signal: sink.signal,
    onLine: (line) => {
      if (result !== undefined) return;
      const parsed = parseCliLine(line);
      switch (parsed.kind) {
        case 'chunks':
          for (const chunk of parsed.chunks) sink.emit(chunk);
          return;
        case 'result':
          result = parsed.result;
          if (result.kind === 'success') sink.emit({ kind: 'final', text: result.text });
          return;
        case 'skip':
          return;
        case 'malformed':
          console.error(`provider-claude: skipped a line from Claude Code: ${parsed.problem}`);
          return;
      }
    },
  });
  if (sink.signal.aborted) return 'cancelled';
  if (result !== undefined) {
    switch (result.kind) {
      case 'success':
        return result.finishReason;
      case 'error':
        throw new Error(`Claude Code: ${result.message}`);
    }
  }
  throw new Error(describeEarlyExit(settings.cliPath, exit));
}

/** Checks that the CLI is installed and signed in. */
export async function checkHealth(settings: Settings): Promise<PluginHealth> {
  const signal = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
  let output = '';
  const exit = await runCommand(settings.cliPath, {
    args: ['auth', 'status', '--json'],
    cwd: settings.cwd,
    input: '',
    files: [],
    signal,
    onLine: (line) => {
      output += `${line}\n`;
    },
  });
  switch (exit.kind) {
    case 'not-found':
    case 'failed':
      return { kind: 'degraded', detail: describeEarlyExit(settings.cliPath, exit) };
    case 'exited':
      break;
  }
  if (signal.aborted) {
    return { kind: 'degraded', detail: `"${settings.cliPath} auth status" did not answer within ${String(HEALTH_TIMEOUT_MS / 1000)} seconds` };
  }
  const status = AuthStatus.safeParse(parseJson(output));
  if (!status.success) {
    const stderr = exit.stderr.trim();
    return {
      kind: 'degraded',
      detail:
        `"${settings.cliPath} auth status" did not report whether you are signed in (exit code ${String(exit.code)}` +
        `${stderr === '' ? '' : `: ${stderr}`}). Update Claude Code and try again.`,
    };
  }
  if (!status.data.loggedIn) {
    return { kind: 'degraded', detail: 'Claude Code is signed out. Run "claude auth login" in a terminal, then check again.' };
  }
  return { kind: 'ok' };
}

function describeEarlyExit(cliPath: string, exit: CommandExit): string {
  switch (exit.kind) {
    case 'not-found':
      return `Claude Code CLI not found ("${cliPath}"). Install Claude Code, or set "Claude Code CLI path" in this plugin's settings.`;
    case 'failed':
      return `Could not start the Claude Code CLI ("${cliPath}"): ${exit.message}`;
    case 'exited': {
      const how = exit.signal === null ? `code ${String(exit.code)}` : `signal ${exit.signal}`;
      const stderr = exit.stderr.trim();
      return `Claude Code exited with ${how} before it replied${stderr === '' ? '' : `: ${stderr}`}`;
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
