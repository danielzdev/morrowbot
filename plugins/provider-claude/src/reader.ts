import type { CommandExit, ProviderError, TurnChunk, TurnEnd, TurnUsage, UsageWindow } from '@morrowbot/plugin-sdk';
import type { ControlRequest } from './control.ts';
import { describeExit } from './exit.ts';
import type { RateLimit } from './rate-limit.ts';
import { parseCliLine, type CliResult, type LineContext } from './stream-json.ts';

/** Reads one turn's stdout lines until the `result`, and remembers the model, the result and any rate-limit refusal. */
export interface TurnReader {
  read(line: string): void;
  /** How the turn ended, once the command has exited. */
  finish(exit: CommandExit, ending: Ending): TurnEnd;
}

/** Where the reader sends what it reads. */
export interface TurnSink {
  emit(chunk: TurnChunk): void;
  /** Plan usage from a `rate_limit_event`. */
  usage(windows: readonly UsageWindow[]): void;
  /** A control request the turn must answer on stdin. */
  control(request: ControlRequest): void;
  /** The `result` arrived: Claude Code asks nothing more, so stdin can close. */
  done(): void;
}

export interface Ending {
  readonly cliPath: string;
  readonly accountKey: string;
  readonly cancelled: boolean;
}

export function createTurnReader(context: LineContext, sink: TurnSink): TurnReader {
  let model: string | null = null;
  let result: CliResult | undefined;
  let rejected: RateLimit['rejected'] = null;
  return {
    read: (line) => {
      if (result !== undefined) return;
      const parsed = parseCliLine(line, context);
      switch (parsed.kind) {
        case 'init':
          model = parsed.model;
          for (const chunk of parsed.chunks) sink.emit(chunk);
          return;
        case 'chunks':
          for (const chunk of parsed.chunks) sink.emit(chunk);
          return;
        case 'control':
          sink.control(parsed.request);
          return;
        case 'rate-limit':
          rejected = parsed.rateLimit.rejected;
          if (parsed.rateLimit.windows.length > 0) sink.usage(parsed.rateLimit.windows);
          return;
        case 'result':
          result = parsed.result;
          sink.done();
          return;
        case 'skip':
          return;
        case 'malformed':
          console.error(`provider-claude: skipped a line from Claude Code: ${parsed.problem}`);
          return;
      }
    },
    finish: (exit, { cliPath, accountKey, cancelled }) => {
      const usage: TurnUsage = result?.usage ?? { kind: 'unavailable' };
      const end = (outcome: TurnEnd['outcome'], finalText: string | null = null, sessionTouched = true): TurnEnd => ({
        outcome,
        usage,
        actualModel: model,
        accountKey,
        sessionTouched,
        finalText,
      });
      if (cancelled) return end({ kind: 'cancelled' });
      if (result !== undefined) {
        switch (result.kind) {
          case 'success':
            return end({ kind: 'completed', finishReason: result.finishReason }, result.text === '' ? null : result.text);
          case 'error':
            return end(failed(rejected === null ? resultError(result.message) : { kind: 'rate-limited', ...rejected }));
        }
      }
      switch (exit.kind) {
        case 'not-found':
          return end(failed({ kind: 'not-installed' }), null, false);
        case 'failed':
          return end(failed({ kind: 'other', message: describeExit(cliPath, exit) }), null, false);
        case 'exited':
          return end(failed({ kind: 'other', message: describeExit(cliPath, exit, ' before it replied') }));
      }
    },
  };
}

/** What an error `result` from Claude Code means. */
export function resultError(message: string): ProviderError {
  if (/not logged in|\/login|\b401\b|authenticat/i.test(message)) return { kind: 'signed-out' };
  if (/rate.?limit|usage limit|hit your limit|\b429\b/i.test(message)) {
    return { kind: 'rate-limited', resetsAt: null, windowId: null };
  }
  return { kind: 'other', message };
}

export function failed(error: ProviderError): TurnEnd['outcome'] {
  return { kind: 'failed', error };
}
