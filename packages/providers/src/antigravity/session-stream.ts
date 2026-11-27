import type { TurnChunk } from '@morrowbot/plugin-sdk';
import { ConfigOptionUpdate, ContentChunk, ModeUpdate, selectOf, ToolCall } from './protocol.ts';
import { describeTool } from './tool-input.ts';

/** agy's mode that asks before every edit and command (`approval-required`). */
export const ASKING_MODE = 'default';

/** Tool kinds that change something. MorrowBot never allows one, so a finished one ran without asking. */
const CHANGING = new Set(['edit', 'delete', 'move', 'execute']);
const ENDED = new Set(['completed', 'failed']);

/** Why the turn must stop at once: agy did something a read-only turn never allows. */
export type Breach =
  | { readonly kind: 'unasked-change'; readonly tool: string }
  | { readonly kind: 'mode-changed'; readonly mode: string };

export interface SessionStream {
  /** Hears one `session/update`. */
  hear(update: unknown): void;
}

export interface StreamOptions {
  readonly home: string | null;
  readonly emit: (chunk: TurnChunk) => void;
  readonly onBreach: (breach: Breach) => void;
}

/** Turns one session's updates into turn chunks: reply text, Thinking, and each tool call's start and end. */
export function createSessionStream(options: StreamOptions): SessionStream {
  const { emit, home } = options;
  const tools = new Map<string, { kind: string | null; title: string | null; ended: boolean }>();
  let thinking = false;
  const breach = options.onBreach;

  const tool = (raw: unknown): void => {
    const parsed = ToolCall.safeParse(raw);
    if (!parsed.success) return;
    const { toolCallId, status } = parsed.data;
    const known = tools.get(toolCallId);
    const entry = known ?? { kind: null, title: null, ended: false };
    entry.kind = parsed.data.kind ?? entry.kind;
    entry.title = parsed.data.title ?? entry.title;
    if (known === undefined) {
      tools.set(toolCallId, entry);
      const shown = describeTool(entry.kind, entry.title, home);
      emit({ kind: 'tool-start', toolUseId: toolCallId, name: shown.name, input: shown.input });
    }
    if (status === null || status === undefined || !ENDED.has(status) || entry.ended) return;
    entry.ended = true;
    emit({ kind: 'tool-end', toolUseId: toolCallId, outcome: status === 'completed' ? 'ok' : 'error' });
    if (status === 'completed' && CHANGING.has(entry.kind ?? '')) breach({ kind: 'unasked-change', tool: describeTool(entry.kind, entry.title, home).label });
  };

  return {
    hear: (update) => {
      const kind = typeof update === 'object' && update !== null && 'sessionUpdate' in update ? update.sessionUpdate : null;
      if (kind !== 'agent_thought_chunk') thinking = false;
      switch (kind) {
        case 'agent_message_chunk': {
          const chunk = ContentChunk.safeParse(update);
          const text = chunk.success && chunk.data.content.type === 'text' ? (chunk.data.content.text ?? '') : '';
          if (text === '') return;
          emit({ kind: 'text', text });
          return;
        }
        case 'agent_thought_chunk':
          if (!thinking) emit({ kind: 'status', text: 'Thinking' });
          thinking = true;
          return;
        case 'tool_call':
        case 'tool_call_update':
          tool(update);
          return;
        case 'config_option_update': {
          const parsed = ConfigOptionUpdate.safeParse(update);
          const mode = parsed.success ? selectOf(parsed.data.configOptions, 'mode') : null;
          if (mode !== null && mode.current !== ASKING_MODE) breach({ kind: 'mode-changed', mode: mode.current });
          return;
        }
        case 'current_mode_update': {
          const parsed = ModeUpdate.safeParse(update);
          if (parsed.success && parsed.data.currentModeId !== ASKING_MODE) breach({ kind: 'mode-changed', mode: parsed.data.currentModeId });
          return;
        }
        default:
          return;
      }
    },
  };
}
