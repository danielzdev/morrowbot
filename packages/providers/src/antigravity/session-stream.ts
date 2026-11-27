import type { TurnChunk } from '@morrowbot/plugin-sdk';
import { ConfigOptionUpdate, ContentChunk, ModeUpdate, selectOf, ToolCall } from './protocol.ts';
import { describeTool } from './tool-input.ts';
import type { Breach } from './tripwire.ts';

/** agy's mode that asks before every edit and command (`approval-required`). */
export const ASKING_MODE = 'default';
/** A mode update MorrowBot cannot read counts as leaving Default mode. */
const UNREADABLE = 'an unreadable mode';

const ENDED = new Set(['completed', 'failed']);

export interface SessionStream {
  /** Hears one `session/update`. */
  hear(update: unknown): void;
  /**
   * The mode agy last announced in an update, or null. Answers to MorrowBot's own changes are not
   * counted: one can be read after a later update, so only updates keep agy's order.
   */
  mode(): string | null;
  /** Forgets the mode heard so far: called just before MorrowBot asks agy for Default mode. */
  forgetMode(): void;
}

export interface StreamOptions {
  readonly home: string | null;
  readonly emit: (chunk: TurnChunk) => void;
  /** Hears agy leave Default mode. Changes finished without asking are the daemon's tripwire's. */
  readonly onBreach: (breach: Extract<Breach, { kind: 'mode-changed' }>) => void;
}

/** Turns one session's updates into turn chunks: reply text, Thinking, and each tool call's start and end. */
export function createSessionStream(options: StreamOptions): SessionStream {
  const { emit, home } = options;
  const tools = new Map<string, { kind: string | null; title: string | null; ended: boolean }>();
  let thinking = false;
  let mode: string | null = null;
  const breach = options.onBreach;
  const heardMode = (current: string): void => {
    mode = current;
    if (current !== ASKING_MODE) breach({ kind: 'mode-changed', mode: current });
  };

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
          if (!parsed.success) heardMode(UNREADABLE);
          else if (parsed.data.configOptions.some((option) => option.id === 'mode')) heardMode(selectOf(parsed.data.configOptions, 'mode')?.current ?? UNREADABLE);
          return;
        }
        case 'current_mode_update': {
          const parsed = ModeUpdate.safeParse(update);
          heardMode(parsed.success ? parsed.data.currentModeId : UNREADABLE);
          return;
        }
        default:
          return;
      }
    },
    mode: () => mode,
    forgetMode: () => {
      mode = null;
    },
  };
}
