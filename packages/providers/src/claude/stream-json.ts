import { z, type FinishReason, type TurnChunk, type TurnUsage } from '@morrowbot/plugin-sdk';
import { parseControlRequest, type ControlRequest } from './control.ts';
import { parseRateLimit, type RateLimit } from './rate-limit.ts';
import { toolInput } from './tool-input.ts';

/** What one line of `claude --output-format stream-json --verbose --include-partial-messages` means for the turn. */
export type CliLine =
  | { readonly kind: 'chunks'; readonly chunks: readonly TurnChunk[] }
  | { readonly kind: 'init'; readonly model: string; readonly chunks: readonly TurnChunk[] }
  | { readonly kind: 'result'; readonly result: CliResult }
  | { readonly kind: 'control'; readonly request: ControlRequest }
  | { readonly kind: 'rate-limit'; readonly rateLimit: RateLimit }
  /** A user message from stdin, echoed back (`--replay-user-messages`) once Claude Code has taken it. */
  | { readonly kind: 'replayed'; readonly uuid: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'malformed'; readonly problem: string };

export type CliResult =
  | { readonly kind: 'success'; readonly text: string; readonly finishReason: FinishReason; readonly usage: TurnUsage }
  | { readonly kind: 'error'; readonly message: string; readonly usage: TurnUsage };

/** What the parser needs from the machine: the home folder, shown as `~` in tool input. */
export interface LineContext {
  readonly home: string | null;
}

const Envelope = z.looseObject({ type: z.string() });

const ParentToolUseId = z.string().nullish();

const SystemLine = z.looseObject({ subtype: z.string(), model: z.string().optional() });

const StreamEventLine = z.looseObject({
  parent_tool_use_id: ParentToolUseId,
  event: z.looseObject({
    type: z.string(),
    delta: z.looseObject({ type: z.string().optional(), text: z.string().optional() }).optional(),
    content_block: z.looseObject({ type: z.string() }).optional(),
  }),
});

const AssistantLine = z.looseObject({
  parent_tool_use_id: ParentToolUseId,
  message: z.looseObject({
    content: z.array(
      z.looseObject({
        type: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
        input: z.json().optional(),
      }),
    ),
  }),
});

const UserLine = z.looseObject({
  parent_tool_use_id: ParentToolUseId,
  uuid: z.string().optional(),
  isReplay: z.boolean().optional(),
  message: z.looseObject({
    content: z.union([
      z.string(),
      z.array(
        z.looseObject({ type: z.string(), tool_use_id: z.string().optional(), is_error: z.boolean().optional() }),
      ),
    ]),
  }),
});

const ResultLine = z.looseObject({
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().nullish(),
  errors: z.array(z.string()).optional(),
  stop_reason: z.string().nullish(),
  usage: z.unknown().optional(),
});

const Tokens = z.number().int().nonnegative();

const ResultUsage = z.looseObject({
  input_tokens: Tokens,
  output_tokens: Tokens,
  cache_read_input_tokens: Tokens.nullish(),
  cache_creation_input_tokens: Tokens.nullish(),
});

const SKIP: CliLine = { kind: 'skip' };

export function parseCliLine(line: string, context: LineContext): CliLine {
  if (line.trim() === '') return SKIP;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { kind: 'malformed', problem: `a ${String(line.length)}-character line that is not JSON` };
  }
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) return { kind: 'malformed', problem: 'a JSON value without a "type"' };
  switch (envelope.data.type) {
    case 'system':
      return parse(SystemLine, json, system);
    case 'stream_event':
      return parse(StreamEventLine, json, streamEvent);
    case 'assistant':
      return parse(AssistantLine, json, (value) => assistant(value, context));
    case 'user':
      return parse(UserLine, json, user);
    case 'result': {
      const parsed = parse(ResultLine, json, result);
      if (parsed.kind !== 'malformed') return parsed;
      return { kind: 'result', result: { kind: 'error', message: `Claude Code ended with ${parsed.problem}`, usage: { kind: 'unavailable' } } };
    }
    case 'control_request': {
      const request = parseControlRequest(json, context.home);
      return request === null ? { kind: 'malformed', problem: 'a "control_request" line without a request id' } : { kind: 'control', request };
    }
    case 'rate_limit_event': {
      const rateLimit = parseRateLimit(json);
      return rateLimit === null ? { kind: 'malformed', problem: 'a "rate_limit_event" line with an unexpected shape' } : { kind: 'rate-limit', rateLimit };
    }
    default:
      return SKIP;
  }
}

function parse<T>(schema: z.ZodType<T>, json: unknown, read: (value: T) => CliLine): CliLine {
  const parsed = schema.safeParse(json);
  if (parsed.success) return read(parsed.data);
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  const type = Envelope.safeParse(json).data?.type ?? 'unknown';
  return { kind: 'malformed', problem: `a "${type}" line with an unexpected shape (${issues.join('; ')})` };
}

function chunks(list: readonly TurnChunk[]): CliLine {
  return list.length === 0 ? SKIP : { kind: 'chunks', chunks: list };
}

function system(line: z.infer<typeof SystemLine>): CliLine {
  if (line.subtype !== 'init' || !line.model) return SKIP;
  return { kind: 'init', model: line.model, chunks: [{ kind: 'status', text: `Started ${line.model}` }] };
}

function streamEvent({ parent_tool_use_id, event }: z.infer<typeof StreamEventLine>): CliLine {
  if (parent_tool_use_id) return SKIP;
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text !== undefined) {
    return chunks([{ kind: 'text', text: event.delta.text }]);
  }
  if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
    return chunks([{ kind: 'status', text: 'Thinking' }]);
  }
  return SKIP;
}

function assistant({ parent_tool_use_id, message }: z.infer<typeof AssistantLine>, context: LineContext): CliLine {
  if (parent_tool_use_id) return SKIP;
  return chunks(
    message.content.flatMap((block): TurnChunk[] =>
      block.type === 'tool_use' && block.id && block.name
        ? [{ kind: 'tool-start', toolUseId: block.id, name: block.name, input: toolInput(block.input ?? null, context.home) }]
        : [],
    ),
  );
}

function user({ parent_tool_use_id, uuid, isReplay, message }: z.infer<typeof UserLine>): CliLine {
  if (isReplay === true && uuid !== undefined) return { kind: 'replayed', uuid };
  if (parent_tool_use_id || typeof message.content === 'string') return SKIP;
  return chunks(
    message.content.flatMap((block): TurnChunk[] =>
      block.type === 'tool_result' && block.tool_use_id
        ? [{ kind: 'tool-end', toolUseId: block.tool_use_id, outcome: block.is_error === true ? 'error' : 'ok' }]
        : [],
    ),
  );
}

function result(line: z.infer<typeof ResultLine>): CliLine {
  const usage = turnUsage(line.usage);
  if (line.is_error || line.subtype !== 'success') {
    const message = line.result?.trim() || (line.errors ?? []).filter((error) => error.trim() !== '').join('; ');
    return {
      kind: 'result',
      result: { kind: 'error', message: message === '' ? `Claude Code stopped (${line.subtype})` : message, usage },
    };
  }
  const finishReason: FinishReason = line.stop_reason === 'max_tokens' ? 'length' : 'stop';
  return { kind: 'result', result: { kind: 'success', text: line.result ?? '', finishReason, usage } };
}

function turnUsage(raw: unknown): TurnUsage {
  const parsed = ResultUsage.safeParse(raw);
  if (!parsed.success) return { kind: 'unavailable' };
  const usage = parsed.data;
  return {
    kind: 'reported',
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? null,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
    outputTokens: usage.output_tokens,
    reasoningTokens: null,
  };
}
