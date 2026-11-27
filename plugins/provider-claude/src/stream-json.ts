import { z, type FinishReason, type StreamChunk } from '@morrowbot/plugin-sdk';

/** What one line of `claude --output-format stream-json --verbose --include-partial-messages` means for the reply. */
export type CliLine =
  | { readonly kind: 'chunks'; readonly chunks: readonly StreamChunk[] }
  | { readonly kind: 'result'; readonly result: CliResult }
  | { readonly kind: 'skip' }
  | { readonly kind: 'malformed'; readonly problem: string };

export type CliResult =
  | { readonly kind: 'success'; readonly text: string; readonly finishReason: FinishReason }
  | { readonly kind: 'error'; readonly message: string };

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
});

const SKIP: CliLine = { kind: 'skip' };

export function parseCliLine(line: string): CliLine {
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
      return parse(AssistantLine, json, assistant);
    case 'user':
      return parse(UserLine, json, user);
    case 'result':
      return parse(ResultLine, json, result);
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

function chunks(list: readonly StreamChunk[]): CliLine {
  return list.length === 0 ? SKIP : { kind: 'chunks', chunks: list };
}

function system(line: z.infer<typeof SystemLine>): CliLine {
  if (line.subtype !== 'init' || !line.model) return SKIP;
  return chunks([{ kind: 'status', text: `Started ${line.model}` }]);
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

function assistant({ parent_tool_use_id, message }: z.infer<typeof AssistantLine>): CliLine {
  if (parent_tool_use_id) return SKIP;
  return chunks(
    message.content.flatMap((block): StreamChunk[] =>
      block.type === 'tool_use' && block.id && block.name
        ? [{ kind: 'tool-start', toolUseId: block.id, name: block.name, input: block.input ?? null }]
        : [],
    ),
  );
}

function user({ parent_tool_use_id, message }: z.infer<typeof UserLine>): CliLine {
  if (parent_tool_use_id || typeof message.content === 'string') return SKIP;
  return chunks(
    message.content.flatMap((block): StreamChunk[] =>
      block.type === 'tool_result' && block.tool_use_id
        ? [{ kind: 'tool-end', toolUseId: block.tool_use_id, outcome: block.is_error === true ? 'error' : 'ok' }]
        : [],
    ),
  );
}

function result(line: z.infer<typeof ResultLine>): CliLine {
  if (line.is_error || line.subtype !== 'success') {
    const message = line.result?.trim() || (line.errors ?? []).filter((error) => error.trim() !== '').join('; ');
    return {
      kind: 'result',
      result: { kind: 'error', message: message === '' ? `Claude Code stopped (${line.subtype})` : message },
    };
  }
  const finishReason: FinishReason = line.stop_reason === 'max_tokens' ? 'length' : 'stop';
  return { kind: 'result', result: { kind: 'success', text: line.result ?? '', finishReason } };
}
